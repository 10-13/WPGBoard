#!/usr/bin/env python3
"""Generate editable province geography from cached public reference data.

Requires Python 3.9+, numpy, scipy and h5py. Example from the workspace root:
  PYTHONPATH=work/geography-environment/deps python3 work/atlas/tools/generate-environment.py
Use --download to populate missing source files (about 75 MB). Source grids and
dependencies stay in work/, never in the distributable. This is a broad game
foundation, not a surveyed soil map or a reconstruction of climate in 1936.
"""

import argparse
import calendar
import collections
import datetime as dt
import hashlib
import json
import math
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import numpy as np
from scipy.io import netcdf_file
from scipy.spatial import cKDTree

try:
    import h5py
except ImportError as exc:
    raise SystemExit("Install h5py in an isolated work/ dependency directory; see this tool's docstring.") from exc


SOURCE = Path(__file__).resolve().parents[1]
WORKSPACE = SOURCE.parents[1]
PERIODS = ((1970, 1979), (1980, 1989), (1990, 2000))
VARIABLES = {
    "temperature": ("2mSI-MO/air.2m.mon.mean.nc", "air"),
    "pressure": ("miscSI-MO/prmsl.mon.mean.nc", "prmsl"),
    "precipitation": ("sfcSI-MO/prate.mon.mean.nc", "prate"),
}
NOAA_BASE = "https://psl.noaa.gov/thredds/ncss/grid/Datasets/20thC_ReanV3/Monthlies/"
DEM_URL = "https://oceania.generic-mapping-tools.org/server/earth/earth_relief/earth_relief_10m_g.grd"
CITIES_URL = "https://download.geonames.org/export/dump/cities5000.zip"
EARTH_KM = 6371.0088


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def subset_url(kind, start, end):
    path, variable = VARIABLES[kind]
    query = urllib.parse.urlencode({
        "var": variable, "north": 90, "west": 0, "east": 359,
        "south": -90, "horizStride": 2, "time_start": f"{start}-01-01T00:00:00Z",
        "time_end": f"{end}-12-31T23:59:59Z", "timeStride": 1, "accept": "netcdf",
    })
    return NOAA_BASE + path + "?" + query


def download_missing(path, url, enabled):
    if path.exists():
        return
    if not enabled:
        raise SystemExit(f"Missing {path}. Supply cached data or run with --download.")
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".partial")
    print(f"Downloading {path.name} ...", flush=True)
    try:
        with urllib.request.urlopen(url, timeout=180) as response, partial.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
        partial.replace(path)
    finally:
        if partial.exists():
            partial.unlink()


def xyz(latitude, longitude):
    lat, lon = np.radians(latitude), np.radians(longitude)
    return np.column_stack((np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)))


def distance_km(chord):
    return 2 * EARTH_KM * math.asin(min(1, float(chord) / 2))


def map_signature(project):
    rows = [[r["id"], r["area"], *r["bbox"], *r["anchor"]]
            for r in sorted(project["provinces"], key=lambda r: r["id"])]
    text = json.dumps([project["width"], project["height"], rows], separators=(",", ":"))
    value = 2166136261
    for byte in text.encode("ascii"):
        value = ((value ^ byte) * 16777619) & 0xFFFFFFFF
    return f"{value:08x}"


def monthly_normals(data_dir):
    """Read every monthly observation, then average each calendar month over 31 years."""
    normals, hashes = {}, []
    expected = {(year, month) for year in range(1970, 2001) for month in range(1, 13)}
    reference_lat, reference_lon = None, None
    for kind, (_, variable) in VARIABLES.items():
        total = None
        counts = np.zeros(12, dtype=np.int64)
        seen = set()
        for start, end in PERIODS:
            path = data_dir / f"{kind}-{start}-{end}.nc"
            with netcdf_file(path, "r", mmap=False) as dataset:
                lat = dataset.variables["lat"][:].copy().astype(float)
                lon = dataset.variables["lon"][:].copy().astype(float)
                hours = dataset.variables["time"][:].copy()
                source = dataset.variables[variable]
                values = source[:].copy().astype(float)
                fill = float(getattr(source, "missing_value", -9.96921e36))
                if np.any(~np.isfinite(values)) or np.any(values == fill):
                    raise ValueError(f"Missing climate samples in {path}")
                if values.shape != (12 * (end - start + 1), len(lat), len(lon)):
                    raise ValueError(f"Truncated or unexpected source shape: {path}")
            if lat[0] > lat[-1]:
                lat, values = lat[::-1], values[:, ::-1]
            if reference_lat is None:
                reference_lat, reference_lon = lat, lon
            if not np.array_equal(lat, reference_lat) or not np.array_equal(lon, reference_lon):
                raise ValueError("Climate variables must use the same regular grid")
            if total is None:
                total = np.zeros((12, len(lat), len(lon)), dtype=np.float64)
            for index, hour in enumerate(hours):
                date = dt.datetime(1800, 1, 1) + dt.timedelta(hours=float(hour))
                key = (date.year, date.month)
                if key in seen or date.year < start or date.year > end:
                    raise ValueError(f"Duplicate or wrong-period month in {path}: {date}")
                seen.add(key)
                field = values[index]
                if kind == "temperature":
                    field = field - 273.15
                elif kind == "pressure":
                    field = field / 100
                else:
                    # One kg/m² of liquid water is one mm. Leap years stay in the mean.
                    field = np.maximum(0, field) * calendar.monthrange(date.year, date.month)[1] * 86400
                total[date.month - 1] += field
                counts[date.month - 1] += 1
            hashes.append({"file": path.name, "sha256": digest(path), "url": subset_url(kind, start, end)})
        if seen != expected or np.any(counts != 31):
            raise ValueError(f"Incomplete 1970–2000 coverage for {kind}")
        normals[kind] = total / counts[:, None, None]
    return normals, reference_lat, reference_lon, hashes


def bilinear(field, lat_axis, lon_axis, latitude, longitude):
    """Regular global longitude grid wraps at 0°; latitude clamps at the poles."""
    y = np.clip((latitude - lat_axis[0]) / (lat_axis[1] - lat_axis[0]), 0, len(lat_axis) - 1)
    x = ((longitude - lon_axis[0]) % 360) / (lon_axis[1] - lon_axis[0])
    y0, x0 = np.floor(y).astype(int), np.floor(x).astype(int) % len(lon_axis)
    y1, x1 = np.minimum(y0 + 1, len(lat_axis) - 1), (x0 + 1) % len(lon_axis)
    fy, fx = y - y0, x - np.floor(x)
    return ((1 - fy) * ((1 - fx) * field[:, y0, x0] + fx * field[:, y0, x1])
            + fy * ((1 - fx) * field[:, y1, x0] + fx * field[:, y1, x1]))


def known_depression(latitude, longitude):
    # Coarse boxes prevent marine bathymetry from becoming a land elevation.
    boxes = ((29.5, 33, 34, 36), (35, 48, 45, 55), (40, 45, 85, 92),
             (28, 31, 25, 30), (10, 16, 39, 44), (35, 37.8, -118, -115),
             (50, 54, 3, 8))
    return any(a <= latitude <= b and c <= longitude <= d for a, b, c, d in boxes)


class Relief:
    def __init__(self, path):
        with h5py.File(path, "r") as dataset:
            self.lat = dataset["lat"][:].astype(float)
            self.lon = dataset["lon"][:].astype(float)
            z = dataset["z"]
            self.z = z[:].astype(float) * float(np.ravel(z.attrs["scale_factor"])[0])
        iy, ix = np.where(self.z[:, :-1] >= 0)
        self.land_positions = np.column_stack((iy, ix))
        self.land = cKDTree(xyz(self.lat[iy], self.lon[ix]))
        self.methods = collections.Counter()

    def sample(self, latitude, longitude):
        y = (latitude - self.lat[0]) / (self.lat[1] - self.lat[0])
        x = (longitude - self.lon[0]) / (self.lon[1] - self.lon[0])
        iy = min(len(self.lat) - 1, max(0, int(round(y))))
        ix = int(round(x)) % (len(self.lon) - 1)
        allow_negative = known_depression(latitude, longitude)
        minimum = -430 if allow_negative else 0
        center = float(self.z[iy, ix])
        method = "nearest-grid-land"
        if center < minimum:
            chord, nearest = self.land.query(xyz([latitude], [longitude])[0])
            if distance_km(chord) <= 75:
                iy, ix = self.land_positions[int(nearest)]
                center = float(self.z[iy, ix])
                method = "nearest-land-within-75-km"
            else:
                self.methods["unresolved-island-sea-level-estimate"] += 1
                return 0, 0
        window = self.z[max(0, iy - 2):min(len(self.lat), iy + 3)][:, (np.arange(ix - 2, ix + 3) % (len(self.lon) - 1))]
        land = window[window >= minimum]
        local_range = float(np.max(land) - np.min(land)) if land.size else 0
        self.methods[method] += 1
        return round(center), round(local_range)


class TimeZones:
    def __init__(self, path):
        self.cities, self.ids = [], {}
        with zipfile.ZipFile(path) as archive:
            filename = next(n for n in archive.namelist() if n.endswith(".txt"))
            for line in archive.read(filename).decode("utf-8").splitlines():
                fields = line.split("\t")
                if len(fields) < 18 or not fields[17]:
                    continue
                city = {"id": int(fields[0]), "lat": float(fields[4]), "lon": float(fields[5]),
                        "country": fields[8], "zone": fields[17]}
                self.ids[city["id"]] = city
                self.cities.append(city)
        self.tree = cKDTree(xyz([c["lat"] for c in self.cities], [c["lon"] for c in self.cities]))
        self.reference = dt.datetime(1936, 1, 1, 12, tzinfo=dt.timezone.utc)
        self.methods = collections.Counter()

    def sample(self, province):
        city = self.ids.get(province.get("cityId"))
        method = "province-city-reference"
        if city is None:
            chord, index = self.tree.query(xyz([province["lat"]], [province["lon"]])[0])
            if distance_km(chord) <= 350:
                city = self.cities[int(index)]
                method = "nearest-city-within-350-km"
        if city is not None:
            try:
                delta = self.reference.astimezone(ZoneInfo(city["zone"])).utcoffset()
                # Historical local mean times can have seconds: the game stores whole minutes.
                minutes = int(round(delta.total_seconds() / 60))
                if abs(minutes) <= 840:
                    self.methods[method] += 1
                    return minutes, city["zone"]
            except ZoneInfoNotFoundError:
                pass
        minutes = int(math.floor(province["lon"] / 15 + 0.5) * 60)
        minutes = min(720, max(-720, minutes))
        self.methods["longitude-solar-fallback"] += 1
        sign = "+" if minutes >= 0 else "−"
        return minutes, f"UTC{sign}{abs(minutes) // 60:02}:00 (по долготе)"


def geographic_belt(latitude):
    value = abs(latitude)
    for limit, belt in ((7, "equatorial"), (20, "subequatorial"), (30, "tropical"),
                        (40, "subtropical"), (60, "temperate"), (70, "subpolar")):
        if value < limit:
            return belt
    return "polar"


def classify(latitude, elevation, relief, temperature, precipitation):
    """Transparent broad heuristics, deliberately not a precise Köppen/soil classification."""
    annual_t = float(np.average(temperature, weights=[31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]))
    annual_p = float(sum(precipitation))
    cold, warm = min(temperature), max(temperature)
    geo = geographic_belt(latitude)
    if warm < 1 or (elevation > 3500 and warm < 5):
        terrain = "ice"
    elif elevation >= 3200:
        terrain = "highlands"
    elif relief >= 900 or elevation >= 2200:
        terrain = "mountains"
    elif elevation >= 900 and relief < 700:
        terrain = "plateau"
    elif relief >= 250 or elevation >= 650:
        terrain = "hills"
    elif elevation < 200:
        terrain = "lowland"
    else:
        terrain = "plain"

    if elevation >= 2200 and geo not in ("polar", "subpolar"):
        belt = "highland"
    elif warm < 10 and (abs(latitude) > 55 or annual_t < 0):
        belt = "polar" if warm < 3 else "subpolar"
    elif annual_t < 2 and abs(latitude) > 45:
        belt = "subpolar"
    else:
        belt = geo

    summer = (5, 6, 7) if latitude >= 0 else (11, 0, 1)
    winter = (11, 0, 1) if latitude >= 0 else (5, 6, 7)
    summer_p = sum(precipitation[i] for i in summer)
    winter_p = sum(precipitation[i] for i in winter)
    dry = annual_p < max(180, 18 * max(annual_t, 0))
    semidry = annual_p < max(400, 30 * max(annual_t, 0))
    mediterranean = (25 <= abs(latitude) <= 45 and annual_t > 10 and
                     summer_p < winter_p * 0.45 and summer_p < 120)
    continental_steppe = (35 <= abs(latitude) <= 56 and 0 <= annual_t <= 17
                          and cold <= 0 and warm >= 18.5 and annual_p < 800)
    if terrain == "ice":
        zone, soil = "ice", "ice"
    elif elevation >= 2500:
        zone, soil = "mountain", "mountain"
    elif warm < 10:
        zone, soil = "tundra", "tundra"
    elif dry:
        zone, soil = "desert", "desert"
    elif mediterranean:
        zone, soil = "mediterranean", "brown"
    elif cold >= 17 and annual_p > 1700 and min(precipitation) > 45:
        zone, soil = "rainforest", "ferralitic"
    elif cold >= 15 and annual_p > 1100:
        zone, soil = "seasonal", "red"
    elif annual_t >= 18 and (semidry or min(precipitation) < 40):
        zone, soil = "savanna", "red" if annual_p > 650 else "chestnut"
    elif annual_t >= 18:
        zone, soil = "seasonal", "red"
    elif semidry or continental_steppe:
        zone, soil = "steppe", "chernozem" if annual_p > 400 and annual_t < 15 else "chestnut"
    elif cold < -10 or annual_t < 3:
        zone, soil = "taiga", "podzol"
    elif cold < 0:
        zone, soil = "mixed", "podzol"
    else:
        zone, soil = "deciduous", "forest"
    return terrain, belt, soil, geo, zone


def generate(args):
    coordinates = json.loads(args.geography.read_text())
    project = json.loads(args.map.read_text())
    provinces = sorted(coordinates["provinces"], key=lambda r: r["id"])
    if (len(provinces) != len(project["provinces"])
            or len({p["id"] for p in provinces}) != len(provinces)
            or {p["id"] for p in provinces} != {p["id"] for p in project["provinces"]}):
        raise ValueError("Geographic coordinates and the map must contain the same province IDs")
    if any(not math.isfinite(p["lat"]) or not math.isfinite(p["lon"])
           or not -90 <= p["lat"] <= 90 or not -180 <= p["lon"] <= 180 for p in provinces):
        raise ValueError("Each province needs finite WGS84 latitude/longitude coordinates")
    for kind in VARIABLES:
        for start, end in PERIODS:
            download_missing(args.data_dir / f"{kind}-{start}-{end}.nc", subset_url(kind, start, end), args.download)
    dem = args.data_dir / "earth-relief-10m.nc"
    download_missing(dem, DEM_URL, args.download)
    download_missing(args.cities, CITIES_URL, args.download)

    normals, lat_axis, lon_axis, hashes = monthly_normals(args.data_dir)
    latitudes = np.array([p["lat"] for p in provinces])
    longitudes = np.array([p["lon"] for p in provinces])
    climate = {kind: bilinear(grid, lat_axis, lon_axis, latitudes, longitudes)
               for kind, grid in normals.items()}
    relief = Relief(dem)
    timezones = TimeZones(args.cities)
    records, categories = [], {kind: collections.Counter() for kind in ("terrain", "belt", "soil", "zone")}
    for index, province in enumerate(provinces):
        elevation, local_relief = relief.sample(province["lat"], province["lon"])
        temperature = np.round(climate["temperature"][:, index], 2).tolist()
        pressure = np.round(climate["pressure"][:, index], 2).tolist()
        precipitation = np.round(climate["precipitation"][:, index], 2).tolist()
        terrain, belt, soil, geographic, zone = classify(province["lat"], elevation, local_relief, temperature, precipitation)
        offset, timezone = timezones.sample(province)
        stats = {
            "geo.lat": province["lat"], "geo.lon": province["lon"],
            "terrain.elevation": elevation, "terrain.relief": local_relief, "terrain.type": terrain,
            "climate.temperature.monthly": temperature, "climate.pressure.monthly": pressure,
            "climate.precipitation.monthly": precipitation, "climate.belt": belt, "climate.soil": soil,
            "climate.geographicBelt": geographic, "climate.naturalZone": zone,
            "time.offsetMinutes": offset, "time.zoneName": timezone,
        }
        if not (-500 <= elevation <= 9000 and 0 <= local_relief <= 10000
                and all(-100 <= t <= 70 for t in temperature)
                and all(800 <= p <= 1100 for p in pressure)
                and all(0 <= p <= 5000 for p in precipitation)):
            raise ValueError(f"Out-of-range environment values for province {province['id']}")
        records.append({"id": province["id"], "stats": stats})
        for kind, value in (("terrain", terrain), ("belt", belt), ("soil", soil), ("zone", zone)):
            categories[kind][value] += 1

    asset = {
        "version": 1,
        "mapSignature": map_signature(project),
        "provinces": records,
        "provenance": {
            "title": "Игровая география: рельеф, климат и фиксированные часовые пояса",
            "period": "1970–2000",
            "referenceDate": "1936-01-01",
            "provinceCount": len(records),
            "sources": [
                {"title": "NOAA/CIRES/DOE 20th Century Reanalysis v3, Monthly Ensemble Means",
                 "url": "https://psl.noaa.gov/data/gridded/data.20thC_ReanV3.html",
                 "period": "1970–2000", "resolution": "Исходная сетка 1°; использована выборка 2°",
                 "license": "Данные NOAA PSL свободно доступны; источник должен быть указан.",
                 "variables": ["air.2m.mon.mean", "prmsl.mon.mean", "prate.mon.mean"], "files": hashes},
                {"title": "GMT Earth Relief 10 arc minutes / SRTM15+ V2.7",
                 "url": "https://www.generic-mapping-tools.org/remote-datasets/earth-relief.html",
                 "downloadUrl": DEM_URL, "doi": "10.1029/2019EA000658", "sha256": digest(dem),
                 "resolution": "10′, сглаживание 52 км; локальный перепад по окрестности 5×5 узлов"},
                {"title": "GeoNames cities5000 — названия IANA часовых поясов",
                 "url": "https://www.geonames.org/", "downloadUrl": CITIES_URL,
                 "license": "CC BY 4.0, GeoNames", "sha256": digest(args.cities)},
                {"title": "Привязка провинций географической основы АТЛАС 1936",
                 "file": "assets/geography-1936.json", "sha256": digest(args.geography)},
            ],
            "methods": [
                "Для каждого месяца усреднены 31 среднемесячное поле NOAA 1970–2000; билинейная интерполяция по центру провинции, долгота замыкается на 360°.",
                "Температура переведена из K в °C; давление — среднее на уровне моря, Па → гПа. Приземное давление в приложении оценивается по высоте и температуре.",
                "Осадки переведены из кг/(м²·с) в мм за фактическое число дней каждого месяца с учётом високосных лет, затем усреднены за 31 год.",
                "Высота — ближайший узел сглаженной сетки. Морские значения исключены, кроме известных впадин. Для побережья ищется суша в радиусе 75 км; неразрешённые маленькие острова получают условные 0 м.",
                "Тип местности оценивается по высоте и перепаду узлов 5×5. Это условные игровые классы, без точного отображения склонов и ледников.",
                "Климатические и географические пояса, почвы и природные зоны — простая модель по широте, высоте, температуре и осадкам. Это не почвенная съёмка, не точная карта Кёппена и не историческая реконструкция.",
                "Часовой пояс берётся из GeoNames для города провинции или ближайшего города до 350 км. Фиксируется IANA-смещение на 1936-01-01 12:00 UTC; исторические секунды округлены до минут. Для удалённых мест используется ближайший солнечный пояс по долготе.",
                "IANA-названия приведены как справочные современные идентификаторы. Смещение игры фиксировано; летнее время автоматически не переводится. Климатическая норма относится к 1970–2000, а не к 1936 году.",
            ],
            "quality": {"reliefSampling": dict(relief.methods), "timezoneSampling": dict(timezones.methods),
                        "categoryCounts": {key: dict(value) for key, value in categories.items()}},
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(asset, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({"output": str(args.output), "bytes": args.output.stat().st_size,
                      "mapSignature": asset["mapSignature"], "provinces": len(records),
                      "quality": asset["provenance"]["quality"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, default=WORKSPACE / "work/geography-environment/data")
    parser.add_argument("--geography", type=Path, default=SOURCE / "assets/geography-1936.json")
    parser.add_argument("--map", type=Path, default=SOURCE / "default-project.json")
    parser.add_argument("--cities", type=Path, default=WORKSPACE / "work/geography-1936/data/cities.zip")
    parser.add_argument("--output", type=Path, default=SOURCE / "assets/environment-geography.json")
    parser.add_argument("--download", action="store_true", help="Download missing public source grids into work/")
    generate(parser.parse_args())
