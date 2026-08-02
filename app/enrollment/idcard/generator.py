import asyncio
import base64
import os
from mimetypes import guess_type
from typing import Any, Dict, List, Tuple, Callable, Optional
from dataclasses import dataclass

import httpx
from playwright.async_api import async_playwright, BrowserContext, Page

from .asset_cache import setup_asset_caching

TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "template.html")
QR_CODE_PATH = os.path.join(os.path.dirname(__file__), "asset", "qr_code.jpg")
BHCPF_QR_CODE_URL = (
    "https://odchc-his.org/healthInsurance/QRCodeImages/17072026124057361_QAS.png"
)

_QR_CACHE: str | None = None
_QR_CACHE_LOCK = asyncio.Lock()


@dataclass
class ProgressEvent:
    success: bool
    path: str


class IdCardGenerator:

    def __init__(self, concurrency: int = 4, http_timeout: float = 15.0):
        self.concurrency = concurrency
        self.http_timeout = http_timeout

    async def fetch_qr_code_asset(self, client: httpx.AsyncClient) -> str:
        global _QR_CACHE


        async with _QR_CACHE_LOCK:
            if _QR_CACHE is not None:
                return _QR_CACHE
        if os.path.exists(QR_CODE_PATH):
            return await asyncio.to_thread(self._read_local_qr)
        try:
            res = await client.get(BHCPF_QR_CODE_URL, timeout=self.http_timeout)
            if res.status_code < 400:
                encoded = base64.b64encode(res.content).decode("utf-8")
                mimetype, _ = guess_type(BHCPF_QR_CODE_URL)
                _QR_CACHE = f"data:{mimetype or 'image/png'};base64,{encoded}"
                return _QR_CACHE
        except Exception:
            pass
        return ""

    @staticmethod
    def _read_local_qr() -> str:
        with open(QR_CODE_PATH, "rb") as f:
            encoded = base64.b64encode(f.read()).decode("utf-8")
            mimetype, _ = guess_type(QR_CODE_PATH)
            return f"data:{mimetype or 'image/jpeg'};base64,{encoded}"

    # ---------- single card rendering ----------

    async def initialize_page(self, page: Page):
        await page.goto(
            f"file://{TEMPLATE_PATH}",
            wait_until="domcontentloaded",
        )

        await page.wait_for_selector("#idNo", state="attached")

        await page.evaluate(
            """
            async () => {
                const sheets = Array.from(document.styleSheets);

                await Promise.all(
                    sheets.map(sheet => {
                        if (sheet.href === null)
                            return Promise.resolve();

                        return new Promise(resolve => {
                            const link =
                                document.querySelector(
                                    `link[href="${sheet.href}"]`
                                );

                            if (!link || link.sheet)
                                return resolve();

                            link.addEventListener("load", resolve);
                            link.addEventListener("error", resolve);
                        });
                    })
                );
            }
            """
        )

    async def _create_id_card(
        self,
        page: Page,
        client: httpx.AsyncClient,
        path: str,
        enrollee_data: Dict[str, Any],
    ) -> str:
        photo_b64 = enrollee_data["passport_b64"]
        qr_b64 = await self.fetch_qr_code_asset(client)

        await page.evaluate(
            """(data) => {
                const modal = document.getElementById('viewIDModal');
                if (modal) {
                    modal.classList.add('show');
                    modal.style.display = 'block';
                    modal.style.opacity = '1';
                    document.body.classList.add('modal-open');
                }

                const fields = {
                    'idNo': data.customID,
                    'idName': `${data.othername} ${data.middleName ? data.middleName[0] + ' ' : ''}${data.surname}`.toUpperCase(),
                    'idPlan_': data.policyData.planName,
                    'idProv': data.provider.trim(),
                    'idLGA': "LGA: " + data.lga,
                    'idPhn': "Phone Number: " + data.mobileNo,
                    'idGend': "Gender: " + data.gender,
                    'idIss': "Date of Issue: " + data.policyData.policyStartDate,
                };

                for (const [id, value] of Object.entries(fields)) {
                    const el = document.getElementById(id);
                    if (el) el.innerText = value;
                }

                const imgEl = document.getElementById('idImg');
                const qrEl = document.getElementById('imgQR');
                if (imgEl) imgEl.src = data.photo_b64;
                if (qrEl) qrEl.src = data.qr_b64;
            }""",
            {**enrollee_data, "photo_b64": photo_b64, "qr_b64": qr_b64},
        )

        card_locator = page.locator("#idCardViewFront")
        await card_locator.wait_for(state="visible")

        await page.evaluate(
            """() => {
            const imgs = Array.from(document.querySelectorAll('#idImg, #imgQR'));
            return Promise.all(imgs.map(img => {
                if (img.complete) return Promise.resolve();
                return new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
            }));
        }"""
        )

        await card_locator.screenshot(path=path, animations="disabled")
        return path

    async def create_id_card(
        self, params: List[Tuple[str, Dict[str, Any]]], callback: Optional[Callable]
    ) -> List[str]:
        sem = asyncio.Semaphore(self.concurrency)
        errors: List[Tuple[str, Exception]] = []
        results: List[str | None] = [None] * len(params)

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                async with httpx.AsyncClient() as client:
                    context: BrowserContext = await browser.new_context(
                        viewport={"width": 1920, "height": 1080}
                    )
                    try:
                        await setup_asset_caching(context, client)

                        page_pool: asyncio.Queue[Page] = asyncio.Queue()

                        pages = await asyncio.gather(
                            *(context.new_page() for _ in range(self.concurrency))
                        )

                        await asyncio.gather(
                            *(self.initialize_page(page) for page in pages)
                        )

                        for page in pages:
                            await page_pool.put(page)

                        async def bound(index: int, path: str, data: Dict[str, Any]):
                            async with sem:
                                page = await page_pool.get()
                                success = False
                                try:
                                    results[index] = await self._create_id_card(
                                        page,
                                        client,
                                        path,
                                        data,
                                    )
                                    success = True
                                except Exception as e:
                                    errors.append((path, e))
                                finally:
                                    await page_pool.put(page)
                                    if callback:
                                        await asyncio.to_thread(
                                            callback,
                                            ProgressEvent(
                                                success=success, path=path
                                            ),
                                        )

                        await asyncio.gather(
                            *(
                                bound(i, path, data)
                                for i, (path, data) in enumerate(params)
                            )
                        )

                        # Close pooled pages.
                        while not page_pool.empty():
                            page = await page_pool.get()
                            await page.close()

                    finally:
                        await context.close()
            finally:
                await browser.close()

        return results, errors  # type: ignore[return-value]

    def create_id_card_sync(
        self,
        params: List[Tuple[str, Dict[str, Any]]],
        callback: Optional[Callable] = None,
    ) -> List[str]:
        """
        Entry from for synchronous interface
        """
        return asyncio.run(self.create_id_card(params, callback))
