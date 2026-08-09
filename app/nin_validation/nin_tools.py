import os
import math
import plotly.graph_objects as go
from playwright.async_api import async_playwright

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(BASE_DIR, "template.html")

COLOR_MAP = {
    "Valid": "#2ecc71",
    "Success (Valid)": "#2ecc71",
    "Invalid": "#e74c3c",
    "Invalid NIN": "#e74c3c",
    "Empty NIN": "#e67e22",
    "Server Timeout / Unverifiable": "#3498db",
    "Incomplete NIN": "#f1c40f"
}

FALLBACK_COLORS = ["#8e44ad", "#16a085", "#d35400", "#7f8c8d", "#2c3e50"]

def get_color_for_status(status_str: str) -> str:
    cleaned = str(status_str).strip()
    if cleaned in COLOR_MAP:
        return COLOR_MAP[cleaned]
    
    status_lower = cleaned.lower()
    if "success" in status_lower:
        return "#2ecc71"
    elif "empty" in status_lower or "missing" in status_lower:
        return "#e67e22"
    elif "timeout" in status_lower or "server" in status_lower:
        return "#3498db"
    elif "incomplete" in status_lower or "length" in status_lower:
        return "#f1c40f"
    elif "invalid" in status_lower or "fail" in status_lower:
        return "#e74c3c"
    color_index = abs(hash(cleaned)) % len(FALLBACK_COLORS)
    return FALLBACK_COLORS[color_index]



def generate_donut_chart(labels, values, center_text, output_path):
    colors = [get_color_for_status(lbl) for lbl in labels] 
    fig = go.Figure(data=[go.Pie(
        labels=labels, 
        values=values, 
        hole=0.6,
        marker=dict(colors=colors),
        textinfo='label+percent',
        hoverinfo='label+value+percent'
    )])
    
    fig.update_layout(
        annotations=[dict(text=f"<b>{center_text:,}</b><br>Total Records", x=0.5, y=0.5, font_size=16, showarrow=False)],
        showlegend=True,
        legend=dict(orient="v", x=1.05, y=0.5),
        margin=dict(t=20, b=20, l=20, r=20),
        width=700,
        height=400
    )
    
    fig.write_image(output_path, scale=2)


def generate_lga_bar_charts(lga_pivot, output_dir):
    lgas = list(lga_pivot.index)
    chunk_size = 6
    total_chunks = math.ceil(len(lgas) / chunk_size)
    image_paths = []

    for i in range(total_chunks):
        chunk_lgas = lgas[i*chunk_size : (i+1)*chunk_size]
        sub_df = lga_pivot.loc[chunk_lgas]

        fig = go.Figure()
        for col in sub_df.columns:
            color = get_color_for_status(col)
            fig.add_trace(go.Bar(
                x=sub_df.index,
                y=sub_df[col],
                name=col,
                marker_color=color,
                text=sub_df[col],
                textposition='auto'
            ))

        start_lga = chunk_lgas[0]
        end_lga = chunk_lgas[-1]
        title_text = f"SR List NIN Verification Result by LGA<br><b>{start_lga} - {end_lga} ({i+1} of {total_chunks})</b>"

        fig.update_layout(
            title=dict(text=title_text, x=0.5, font=dict(size=14)),
            barmode='group',
            yaxis_title="Record Count",
            xaxis=dict(tickangle=-25),
            legend=dict(title="Audit Status", x=1.02, y=1),
            margin=dict(t=60, b=80, l=50, r=50),
            width=900,
            height=450
        )

        out_path = os.path.join(output_dir, f"lga_chart_{i+1}.png")
        fig.write_image(out_path, scale=2)
        image_paths.append(out_path)

    return image_paths

async def render_pdf_from_html(html_content: str, output_pdf_path: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True, 
            args=["--no-sandbox", "--disable-dev-shm-usage"]
        )
        context = await browser.new_context()
        page = await context.new_page()
        
        await page.set_content(html_content, wait_until="networkidle")
        
        await page.pdf(
            path=output_pdf_path,
            format="A4",
            print_background=True
        )
        await context.close()
        await browser.close()