"""Vote Play — verificação de contraste da paleta da marca.

Victor Neves (voaneves.com) · © 2026. Todos os direitos reservados.
"""
from colors import hsl_to_rgb, hexs, ratio

T = {
    'noite': (344,32,7), 'palco': (344,26,11), 'luz': (20,20,96), 'nevoa': (20,10,68),
    'coral': (6,89,58), 'alerta': (359,69,62), 'confirmado': (152,60,42),
    'rotulo-sobre-acao': (344,32,7),
}
r = {k: hsl_to_rgb(*v) for k,v in T.items()}
print("=== depois da correção ===")
pairs = [
    ('luz','noite','texto principal sobre fundo'),
    ('nevoa','noite','texto secundário sobre fundo'),
    ('nevoa','palco','texto secundário sobre card'),
    ('coral','noite','cronômetro / destaque sobre fundo'),
    ('coral','palco','destaque sobre card'),
    ('rotulo-sobre-acao','coral','RÓTULO DO BOTÃO PRIMÁRIO'),
    ('confirmado','noite','sucesso sobre fundo'),
    ('alerta','noite','ERRO sobre fundo'),
    ('rotulo-sobre-acao','alerta','rótulo sobre erro sólido'),
]
ok = True
for a,b,label in pairs:
    v = ratio(r[a], r[b])
    verdict = 'AA' if v >= 4.5 else 'REPROVA'
    if v < 4.5: ok = False
    print(f"  {label:38} {v:>6}  {verdict}")
print()
print("alerta =", hexs(r['alerta']))
print("TODOS OS PARES PASSAM AA" if ok else "AINDA HÁ REPROVAÇÃO")
