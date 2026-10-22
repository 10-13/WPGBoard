"""Build a lossless province index from the supplied palette PNG."""
from pathlib import Path
import base64
import json
import sys
from io import BytesIO
import numpy as np
from scipy import ndimage
from PIL import Image

ROOT = Path(__file__).parent
SOURCE = Path(sys.argv[1]).expanduser() if len(sys.argv)>1 else Path.home() / 'Downloads' / 'Пустая карта.png'


def data_url(image):
    stream = BytesIO()
    image.save(stream, format='PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()


def main():
    source_image = Image.open(SOURCE)
    original = source_image.convert('RGB')
    if source_image.format == 'PNG':
        original_bytes = SOURCE.read_bytes()
    else:
        original_stream = BytesIO()
        original.save(original_stream, format='PNG')
        original_bytes = original_stream.getvalue()
    pixels = np.asarray(original)
    # The original has exact gray land, black borders and blue water.
    mask = np.all(pixels == (128, 128, 128), axis=2)
    labels, count = ndimage.label(mask)
    assert count < 65536
    boxes = ndimage.find_objects(labels)
    sizes = np.bincount(labels.ravel())
    provinces = []
    for province_id, (ys, xs) in enumerate(boxes, 1):
        local_y, local_x = np.nonzero(labels[ys, xs] == province_id)
        cx, cy = float(local_x.mean()), float(local_y.mean())
        nearest = ((local_x - cx) ** 2 + (local_y - cy) ** 2).argmin()
        provinces.append({
            'id': province_id, 'area': int(sizes[province_id]),
            'bbox': [xs.start, ys.start, xs.stop-xs.start, ys.stop-ys.start],
            'anchor': [int(local_x[nearest]+xs.start), int(local_y[nearest]+ys.start)],
        })
    encoded = np.zeros((*labels.shape, 3), dtype=np.uint8)
    encoded[:, :, 0] = labels & 255
    encoded[:, :, 1] = (labels >> 8) & 255
    styled = np.empty_like(pixels)
    styled[:] = (199, 218, 225)
    styled[np.all(pixels == 0, axis=2)] = (102, 116, 119)
    styled[mask] = (246, 242, 231)
    project = {
        'schemaVersion': 1, 'saveId': 'atlas-default-v1',
        'title': 'Новая кампания', 'mapName': SOURCE.name,
        'width': original.width, 'height': original.height,
        'baseImage': data_url(Image.fromarray(styled)),
        'originalImage': 'data:image/png;base64,' + base64.b64encode(original_bytes).decode(),
        'indexImage': data_url(Image.fromarray(encoded)),
        'provinces': provinces, 'owners': {}, 'regionAssignments': {}, 'provinceNames': {},
        'nations': [
            {'id': 'nation-1', 'name': 'Северный союз', 'color': '#517eaa'},
            {'id': 'nation-2', 'name': 'Республика', 'color': '#c47862'},
            {'id': 'nation-3', 'name': 'Федерация', 'color': '#75937d'},
        ], 'regions': [],
    }
    (ROOT / 'default-project.json').write_text(json.dumps(project, ensure_ascii=False, separators=(',', ':')))
    (ROOT / 'assets').mkdir(exist_ok=True)
    (ROOT / 'assets' / 'original-map.png').write_bytes(original_bytes)
    previews = ROOT.parent.parent / '.local/previews'
    previews.mkdir(parents=True, exist_ok=True)
    Image.fromarray(styled).resize((1872,1000)).save(previews / 'map-preview.png')
    print(f'{count} provinces, {original.width}×{original.height}; land coverage {int(mask.sum()):,} pixels')
    assert sum(p['area'] for p in provinces) == int(mask.sum())
    assert set(np.unique(labels)) == set(range(count+1))
    for p in provinces:
        x, y = p['anchor']
        assert labels[y,x] == p['id']
    print('Verified: every land pixel indexed exactly once; every label anchor belongs to its province.')


if __name__ == '__main__':
    main()
