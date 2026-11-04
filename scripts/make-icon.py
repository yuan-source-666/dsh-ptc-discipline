
from PIL import Image, ImageDraw
S = 4
W = 180 * S
img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
k = W / 64.0
def sc(*v): return [x * k for x in v]
# rounded plate
d.rounded_rectangle(sc(2,2,62,62), radius=14*k, fill="#1b2430")
# target ring
cx, cy, r = 26*k, 26*k, 11*k
d.ellipse([cx-r, cy-r, cx+r, cy+r], outline="#38d6a0", width=int(3*k))
d.ellipse([cx-4.5*k, cy-4.5*k, cx+4.5*k, cy+4.5*k], fill="#38d6a0")
# underline bars
for y, w in ((44, 14), (50, 9)):
    d.line([18*k, y*k, (18+w)*k, y*k], fill="#7d8fa3", width=int(3*k))
    d.ellipse([18*k-int(1.5*k), y*k-int(1.5*k), 18*k+int(1.5*k), y*k+int(1.5*k)], fill="#7d8fa3")
    d.ellipse([(18+w)*k-int(1.5*k), y*k-int(1.5*k), (18+w)*k+int(1.5*k), y*k+int(1.5*k)], fill="#7d8fa3")
# checkmark
pts = [40*k, 40*k, 46*k, 46*k, 56*k, 34*k]
d.line([pts[0],pts[1],pts[2],pts[3]], fill="#f2b134", width=int(4*k))
d.line([pts[2],pts[3],pts[4],pts[5]], fill="#f2b134", width=int(4*k))
for i in (0, 2, 1):
    pass
for x, y in ((40,40),(46,46),(56,34)):
    rr = 2*k
    d.ellipse([x*k-rr, y*k-rr, x*k+rr, y*k+rr], fill="#f2b134")
img = img.resize((180, 180), Image.LANCZOS)
import os
os.makedirs("assets", exist_ok=True)
img.save("assets/icon-180.png")
print("saved", img.size, os.path.getsize("assets/icon-180.png"))
