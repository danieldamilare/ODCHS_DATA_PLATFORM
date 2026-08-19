import os
import math
import plotly.graph_objects as go
from playwright.async_api import async_playwright

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(BASE_DIR, "template.html")

COLOR_MAP = {
    "Valid": "#2ecc71",
    "Success (Valid)": "#2ecc71",
    "Success": "#2ecc71",
    "Invalid": "#e74c3c",
    "Invalid NIN": "#e74c3c",
    "Empty NIN": "#e67e22",
    "Server Timeout / Unverifiable": "#3498db",
    "Server Timeout": "#3498db",
    "Incomplete NIN": "#f1c40f",
    "Non-digit NIN": "#e74c3c",
}

FALLBACK_COLORS = ["#8e44ad", "#16a085", "#d35400", "#7f8c8d", "#2c3e50"]


def clean_label(lbl: str) -> str:
    l = str(lbl).strip()
    if len(l) > 28:
        low = l.lower()
        if "unable to verify" in low or "timeout" in low or "server" in low:
            return "Server Timeout"
        if "not found" in low or "not valid" in low or "invalid nin" in low:
            return "Invalid NIN"
        if "non digit" in low:
            return "Non-digit NIN"
        if "length" in low or "incomplete" in low or "11" in low:
            return "Incomplete NIN"
        if "empty" in low or "missing" in low:
            return "Empty NIN"
        return l[:24] + "..."
    return l


def get_color_for_status(status_str: str) -> str:
    cleaned = clean_label(status_str)
    if cleaned in COLOR_MAP:
        return COLOR_MAP[cleaned]

    status_lower = str(status_str).lower()
    if "success" in status_lower or "valid" in status_lower:
        return "#2ecc71"
    elif "empty" in status_lower or "missing" in status_lower:
        return "#e67e22"
    elif "timeout" in status_lower or "server" in status_lower or "unverifiable" in status_lower:
        return "#3498db"
    elif "incomplete" in status_lower or "length" in status_lower or "11" in status_lower:
        return "#f1c40f"
    elif "invalid" in status_lower or "fail" in status_lower or "non digit" in status_lower:
        return "#e74c3c"
    color_index = abs(hash(cleaned)) % len(FALLBACK_COLORS)
    return FALLBACK_COLORS[color_index]


def generate_donut_chart(labels, values, center_text, output_path, title="Overall NIN Verification Status"):
    short_labels = [clean_label(lbl) for lbl in labels]
    colors = [get_color_for_status(lbl) for lbl in short_labels]

    fig = go.Figure(
        data=[
            go.Pie(
                labels=short_labels,
                values=values,
                hole=0.55,
                marker=dict(colors=colors, line=dict(color="#ffffff", width=2)),
                textinfo="percent",
                textposition="inside",
                hoverinfo="label+value+percent",
                insidetextorientation="horizontal",
            )
        ]
    )

    fig.update_layout(
        title=dict(
            text=f"<b>{title}</b>",
            x=0.5,
            font=dict(size=16, color="#27ae60", family="Helvetica, Arial, sans-serif"),
        ),
        annotations=[
            dict(
                text=f"<b>{center_text:,}</b><br><span style=\"font-size:11px;color:#7f8c8d;\">Total Records</span>",
                x=0.5,
                y=0.5,
                font_size=15,
                showarrow=False,
                font_family="Helvetica, Arial, sans-serif",
            )
        ],
        showlegend=True,
        legend=dict(
            title=dict(text="<b>Audit Status</b>", font=dict(size=11)),
            orientation="v",
            x=1.02,
            y=0.5,
            font=dict(size=10, family="Helvetica, Arial, sans-serif"),
        ),
        margin=dict(t=50, b=20, l=30, r=30),
        width=750,
        height=320,
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
    )

    fig.write_image(output_path, scale=2)


def generate_lga_bar_charts(lga_pivot, output_dir):
    lgas = list(lga_pivot.index)
    chunk_size = 6
    total_chunks = math.ceil(len(lgas) / chunk_size)
    image_paths = []

    for i in range(total_chunks):
        chunk_lgas = lgas[i * chunk_size : (i + 1) * chunk_size]
        sub_df = lga_pivot.loc[chunk_lgas]

        fig = go.Figure()
        for col in sub_df.columns:
            col_clean = clean_label(col)
            color = get_color_for_status(col_clean)
            fig.add_trace(
                go.Bar(
                    x=sub_df.index,
                    y=sub_df[col],
                    name=col_clean,
                    marker_color=color,
                    text=sub_df[col],
                    textposition="outside",
                    textfont=dict(size=9),
                )
            )

        start_lga = chunk_lgas[0]
        end_lga = chunk_lgas[-1]
        title_text = f"<span style=\"color:#27ae60;font-size:15px;\"><b>SR List NIN Verification Result by LGA</b></span><br><span style=\"font-size:12px;color:#2c3e50;\"><b>{start_lga} - {end_lga} ({i+1} of {total_chunks})</b></span>"

        fig.update_layout(
            title=dict(text=title_text, x=0.5, font=dict(family="Helvetica, Arial, sans-serif")),
            barmode="group",
            yaxis_title="Record Count",
            yaxis=dict(gridcolor="#f0f0f0", zeroline=False),
            xaxis=dict(tickangle=-25, tickfont=dict(size=10)),
            legend=dict(
                title=dict(text="<b>Audit Status</b>", font=dict(size=11)),
                x=1.02,
                y=1,
                font=dict(size=10, family="Helvetica, Arial, sans-serif"),
            ),
            margin=dict(t=60, b=70, l=50, r=40),
            width=800,
            height=380,
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
        )

        out_path = os.path.join(output_dir, f"lga_chart_{i+1}.png")
        fig.write_image(out_path, scale=2)
        image_paths.append(out_path)

    return image_paths


async def render_pdf_from_html(html_content: str, output_pdf_path: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"]
        )
        context = await browser.new_context()
        page = await context.new_page()

        await page.set_content(html_content, wait_until="networkidle")

        await page.pdf(path=output_pdf_path, format="A4", print_background=True)
        await context.close()
        await browser.close()
