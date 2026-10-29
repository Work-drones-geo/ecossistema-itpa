import base64
from pathlib import Path

base_dir = Path(__file__).resolve().parent.parent
logo_path = base_dir / "assets" / "logo-work-drones.jpeg"
qr_path = base_dir / "assets" / "qrcode-anac.jpeg"
out_path = base_dir / "js" / "assets_laudo.js"

logo_b64 = base64.b64encode(logo_path.read_bytes()).decode("ascii")
qr_b64 = base64.b64encode(qr_path.read_bytes()).decode("ascii")

content = f"""/**
 * Assets embutidos para emissão de Laudos Periciais em PDF
 * WORK DRONES GEO & Ecossistema ITPA
 */
window.ITPA_ASSETS_LAUDO = {{
  LOGO_WORK_DRONES: "data:image/jpeg;base64,{logo_b64}",
  QRCODE_ANAC: "data:image/jpeg;base64,{qr_b64}"
}};
"""

out_path.write_text(content, encoding="utf-8")
print(f"Sucesso: {out_path.name} gerado com {len(content)} caracteres.")
