import json, math

def hsl_to_rgb(h, s, l):
    s, l = s/100, l/100
    c = (1-abs(2*l-1))*s
    x = c*(1-abs((h/60) % 2 - 1))
    m = l - c/2
    r,g,b = [(c,x,0),(x,c,0),(0,c,x),(0,x,c),(x,0,c),(c,0,x)][int(h//60) % 6]
    return tuple(round((v+m)*255) for v in (r,g,b))

def hexs(rgb): return '#%02X%02X%02X' % rgb

def lum(rgb):
    def f(v):
        v/=255
        return v/12.92 if v <= 0.03928 else ((v+0.055)/1.055)**2.4
    r,g,b = [f(v) for v in rgb]
    return 0.2126*r + 0.7152*g + 0.0722*b

def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la,lb), min(la,lb)
    return round((hi+0.05)/(lo+0.05), 2)

tokens = {
    'noite':        (344, 32, 7),    # background
    'palco':        (344, 26, 11),   # card
    'bastidor':     (344, 16, 18),   # muted
    'contorno':     (344, 18, 20),   # border
    'luz':          (20, 20, 96),    # foreground
    'nevoa':        (20, 10, 68),    # muted-foreground
    'coral':        (6, 89, 58),     # primary / ação
    'vinho':        (344, 42, 27),   # accent / marca
    'brasa':        (359, 69, 41),   # secondary-highlight
    'alerta':       (359, 69, 48),   # destructive
    'confirmado':   (152, 60, 42),   # success
}
rgb = {k: hsl_to_rgb(*v) for k,v in tokens.items()}

print(f"{'token':12} {'HEX':9} {'HSL':18} {'contraste s/ noite':>18}")
for k,v in tokens.items():
    c = ratio(rgb[k], rgb['noite'])
    print(f"{k:12} {hexs(rgb[k]):9} {str(v):18} {c:>18}")

print()
print("--- pares que a interface realmente usa ---")
pairs = [
    ('luz', 'noite', 'texto principal sobre fundo'),
    ('nevoa', 'noite', 'texto secundário sobre fundo'),
    ('nevoa', 'palco', 'texto secundário sobre card'),
    ('coral', 'noite', 'destaque/cronômetro sobre fundo'),
    ('coral', 'palco', 'destaque sobre card'),
    ('luz', 'coral', 'texto no botão primário'),
    ('confirmado', 'noite', 'sucesso sobre fundo'),
    ('alerta', 'noite', 'erro sobre fundo'),
]
for a,b,label in pairs:
    r = ratio(rgb[a], rgb[b])
    aa = 'AA' if r >= 4.5 else ('AA grande' if r >= 3 else 'REPROVA')
    print(f"  {label:38} {r:>6}  {aa}")

json.dump({k: hexs(v) for k,v in rgb.items()}, open('/home/claude/brand/palette.json','w'), indent=2, ensure_ascii=False)
