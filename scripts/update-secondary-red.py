from pathlib import Path

path = Path('/home/ubuntu/KAZER/interface/chat.html')
source = path.read_text()
replacements = {
    '#9b8dff': '#c53a3f',
    '#9776ff': '#d0444d',
    '#bfb4ff': '#f0a0a3',
    '#c8c2ff': '#f0a0a3',
    '#8c7aff': '#a51e2b',
    '#d8d2ff': '#ef6a70',
    'rgba(151,118,255': 'rgba(197,58,63',
    'rgba(140,122,255': 'rgba(197,58,63',
}
for old, new in replacements.items():
    source = source.replace(old, new)
path.write_text(source)
print(f'Atualizada a paleta secundária vermelha em {path}')
for old in replacements:
    print(f'{old}: {source.count(old)} restante(s)')
