"""Original, deterministic MIT-licensed fixture illustrations; Pillow only."""
from pathlib import Path
from PIL import Image, ImageDraw

output = Path(__file__).resolve().parent
chart = Image.new("RGB", (160, 100), "white")
draw = ImageDraw.Draw(chart)
draw.text((10, 6), "Learning progress", fill="#223344")
draw.line((16, 82, 148, 82), fill="#223344", width=2)
for x, height, color in [(28, 30, "#3377bb"), (68, 46, "#44aa88"), (108, 62, "#eeaa44")]:
    draw.rectangle((x, 82 - height, x + 22, 80), fill=color)
chart.save(output / "learning-chart.png", optimize=False)

landscape = Image.new("RGB", (160, 100))
for y in range(100):
    for x in range(160):
        landscape.putpixel((x, y), (90 + y, 155 + y // 3, 220 - y // 2))
draw = ImageDraw.Draw(landscape)
draw.ellipse((116, 12, 138, 34), fill="#ffed99")
draw.polygon([(0, 80), (38, 30), (85, 83)], fill="#667f88")
draw.polygon([(52, 88), (110, 39), (160, 83), (160, 100), (0, 100)], fill="#365e51")
draw.polygon([(27, 45), (38, 30), (52, 46), (40, 43)], fill="#eeeeee")
draw.line((0, 91, 160, 91), fill="#214c70", width=8)
landscape.save(output / "mountain-landscape.jpg", quality=90, optimize=False, progressive=False, subsampling=0)
