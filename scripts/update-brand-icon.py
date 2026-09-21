from base64 import b64encode
from io import BytesIO
from pathlib import Path

from PIL import Image

SOURCE = Path('/home/ubuntu/upload/1000082107.jpg')
ROOT = Path(__file__).resolve().parents[1]

# The supplied reference is a presentation frame; this centered square crop keeps
# the complete black/red composition while making the mark safe for app icons.
image = Image.open(SOURCE).convert('RGB')
side = min(image.size)
left = (image.width - side) // 2
top = (image.height - side) // 2
crop = image.crop((left, top, left + side, top + side))
master = crop.resize((1024, 1024), Image.Resampling.LANCZOS)

png_buffer = BytesIO()
master.save(png_buffer, format='PNG', optimize=True)
embedded_png = b64encode(png_buffer.getvalue()).decode('ascii')

# Keep the same visual mark across web, PWA, Android, and store assets while
# preserving the dimensions expected by each platform.
outputs = {
    ROOT / 'download/assets/kazer-symbol.png': 1024,
    ROOT / 'download/assets/kazer-login-symbol.png': 1024,
    ROOT / 'download/assets/kazer-logo.jpg': 1024,
    ROOT / 'download/icons/kazer-192.png': 192,
    ROOT / 'download/icons/kazer-512.png': 512,
    ROOT / 'download/android/twa/store_icon.png': 512,
    ROOT / 'download/android/twa/app/src/main/res/mipmap-hdpi/ic_launcher.png': 72,
    ROOT / 'download/android/twa/app/src/main/res/mipmap-mdpi/ic_launcher.png': 48,
    ROOT / 'download/android/twa/app/src/main/res/mipmap-xhdpi/ic_launcher.png': 96,
    ROOT / 'download/android/twa/app/src/main/res/mipmap-xxhdpi/ic_launcher.png': 144,
    ROOT / 'download/android/twa/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png': 192,
    ROOT / 'download/android/twa/app/src/main/res/drawable-mdpi/ic_notification_icon.png': 24,
    ROOT / 'download/android/twa/app/src/main/res/drawable-hdpi/ic_notification_icon.png': 36,
    ROOT / 'download/android/twa/app/src/main/res/drawable-xhdpi/ic_notification_icon.png': 48,
    ROOT / 'download/android/twa/app/src/main/res/drawable-xxhdpi/ic_notification_icon.png': 72,
    ROOT / 'download/android/twa/app/src/main/res/drawable-xxxhdpi/ic_notification_icon.png': 96,
}

for path, size in outputs.items():
    path.parent.mkdir(parents=True, exist_ok=True)
    resized = master if size == 1024 else master.resize((size, size), Image.Resampling.LANCZOS)
    if path.suffix.lower() == '.jpg':
        resized.save(path, format='JPEG', quality=95, optimize=True)
    else:
        resized.save(path, format='PNG', optimize=True)

# The SVG brand assets are kept as self-contained wrappers around the same mark
# so no old K-shaped artwork remains in the distribution set.
for name in ('kazer-logo.svg', 'kazer-mark.svg', 'kazer-mark-glyph.svg'):
    path = ROOT / 'download/assets' / name
    path.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
        'role="img" aria-labelledby="title desc">\n'
        '  <title id="title">Símbolo KAZER</title>\n'
        '  <desc id="desc">Ícone KAZER com o personagem de chapéu sobre fundo preto.</desc>\n'
        f'  <image href="data:image/png;base64,{embedded_png}" width="1024" height="1024" preserveAspectRatio="none"/>\n'
        '</svg>\n'
    )

print(f'Atualizados {len(outputs)} assets raster e 3 wrappers SVG a partir de {SOURCE}')
