"""
"알리약" 앱 아이콘을 코드로 생성한다(디자이너 리소스 없이 캡슐 알약 + 알림 신호 모티프).
한 번 만들어두면 재실행할 필요는 없다 - 로고를 바꾸고 싶을 때만 다시 실행.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "icons"
ICON_DIR.mkdir(exist_ok=True)

BG = (37, 99, 235)  # --primary
WHITE = (255, 255, 255)
ACCENT = (251, 146, 60)  # 따뜻한 주황 - "알리다"(알림) 포인트, 캡슐 반쪽 + 신호점에 사용


def draw_master(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 배경: 둥근 사각형
    radius = size * 0.22
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BG)

    # 캡슐(알약) 심볼: 두 반원 + 사각형을 대각선 배치, 흰색/주황 두 톤(실제 캡슐 느낌 + 브랜드 포인트)
    cap_len = size * 0.62
    cap_w = size * 0.24
    cx, cy = size / 2, size / 2

    left = cx - cap_len / 2
    right = cx + cap_len / 2
    top = cy - cap_w / 2
    bottom = cy + cap_w / 2

    # 알약 실루엣(마스크)을 따로 만들어, 두 톤 채색이 둥근 캡슐 밖으로 삐져나오지 않게 클리핑한다.
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([left, top, right, bottom], radius=cap_w / 2, fill=255)

    color_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cld = ImageDraw.Draw(color_layer)
    cld.rectangle([left, top, cx, bottom], fill=WHITE)
    cld.rectangle([cx, top, right, bottom], fill=ACCENT)

    capsule = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    capsule.paste(color_layer, (0, 0), mask)
    ImageDraw.Draw(capsule).rounded_rectangle(
        [left, top, right, bottom], radius=cap_w / 2, outline=WHITE, width=max(1, int(size * 0.012))
    )

    capsule = capsule.rotate(-40, resample=Image.BICUBIC, center=(cx, cy))
    img = Image.alpha_composite(img, capsule)

    # "알리다"를 상징하는 작은 신호점 3개(우상단, 점점 옅어지는 방사형) - 절제된 포인트로만
    d = ImageDraw.Draw(img)
    signal_cx, signal_cy = size * 0.775, size * 0.225
    for i, (r, alpha) in enumerate([(size * 0.05, 255), (size * 0.032, 190), (size * 0.02, 255)]):
        offset = i * size * 0.075
        d.ellipse(
            [signal_cx + offset * 0.35 - r, signal_cy - offset * 0.35 - r,
             signal_cx + offset * 0.35 + r, signal_cy - offset * 0.35 + r],
            fill=(*ACCENT, alpha) if i != 2 else (*WHITE, alpha),
        )
    return img


def main():
    master = draw_master(1024)
    sizes = [512, 192, 180, 32, 16]
    for s in sizes:
        resized = master.resize((s, s), Image.LANCZOS)
        resized.save(ICON_DIR / f"icon-{s}.png")
    # favicon.ico (여러 해상도 포함)
    master.resize((256, 256), Image.LANCZOS).save(
        ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
    )
    print(f"저장 완료: {ICON_DIR} + {ROOT / 'favicon.ico'}")


if __name__ == "__main__":
    main()
