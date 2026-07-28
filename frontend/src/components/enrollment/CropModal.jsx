import { useState, useRef, useEffect, useCallback } from "react";
import { X, Crosshair } from "lucide-react";

export default function CropModal({ imgSrc, initialCoords, onApply, onClose }) {
    const canvasRef = useRef(null);
    const imgRef = useRef(null);
    const [imgLoaded, setImgLoaded] = useState(false);

    // Snipping state
    const [drawing, setDrawing] = useState(false);
    const [startPt, setStartPt] = useState(null);
    const [endPt, setEndPt] = useState(null);
    const [box, setBox] = useState(null);

    // Initialize from existing coordinates
    useEffect(() => {
        if (initialCoords && initialCoords.xmax > 0) {
            setBox({
                x: initialCoords.xmin,
                y: initialCoords.ymin,
                w: initialCoords.xmax - initialCoords.xmin,
                h: initialCoords.ymax - initialCoords.ymin,
            });
        }
    }, [initialCoords]);

    // ── Draw overlay ──
    const drawOverlay = useCallback(() => {
        const canvas = canvasRef.current;
        const img = imgRef.current;
        if (!canvas || !img || !imgLoaded) return;

        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Determine which box to draw: active drawing or committed box
        const activeBox = drawing && startPt && endPt
            ? normalizeRect(startPt, endPt)
            : box;

        if (!activeBox || activeBox.w <= 0 || activeBox.h <= 0) {
            // No selection — just show semi-transparent overlay
            ctx.fillStyle = "rgba(0,0,0,0.35)";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            return;
        }

        // Dark overlay outside selection
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.clearRect(activeBox.x, activeBox.y, activeBox.w, activeBox.h);

        // Selection border
        ctx.strokeStyle = "#818cf8"; // indigo-400
        ctx.lineWidth = 3;
        if (drawing) {
            ctx.setLineDash([8, 4]);
        } else {
            ctx.setLineDash([]);
        }
        ctx.strokeRect(activeBox.x, activeBox.y, activeBox.w, activeBox.h);
        ctx.setLineDash([]);

        // Corner markers (small L-shapes at each corner)
        if (!drawing) {
            const len = Math.min(20, activeBox.w / 4, activeBox.h / 4);
            ctx.strokeStyle = "#6366f1"; // indigo-500
            ctx.lineWidth = 4;
            const corners = [
                [activeBox.x, activeBox.y, 1, 1],
                [activeBox.x + activeBox.w, activeBox.y, -1, 1],
                [activeBox.x, activeBox.y + activeBox.h, 1, -1],
                [activeBox.x + activeBox.w, activeBox.y + activeBox.h, -1, -1],
            ];
            for (const [cx, cy, dx, dy] of corners) {
                ctx.beginPath();
                ctx.moveTo(cx + len * dx, cy);
                ctx.lineTo(cx, cy);
                ctx.lineTo(cx, cy + len * dy);
                ctx.stroke();
            }
        }
    }, [box, drawing, startPt, endPt, imgLoaded]);

    useEffect(() => {
        drawOverlay();
    }, [drawOverlay]);

    // ── Coordinate helpers ──

    function getCanvasCoords(e) {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX)),
            y: Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY)),
        };
    }

    function normalizeRect(p1, p2) {
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        return {
            x, y,
            w: Math.abs(p2.x - p1.x),
            h: Math.abs(p2.y - p1.y),
        };
    }

    // ── Mouse handlers (snipping tool) ──

    function handleMouseDown(e) {
        const pos = getCanvasCoords(e);
        setDrawing(true);
        setStartPt(pos);
        setEndPt(pos);
        setBox(null); // clear previous selection
    }

    function handleMouseMove(e) {
        if (!drawing) return;
        setEndPt(getCanvasCoords(e));
    }

    function handleMouseUp() {
        if (!drawing || !startPt || !endPt) return;
        setDrawing(false);
        const rect = normalizeRect(startPt, endPt);
        if (rect.w > 10 && rect.h > 10) {
            setBox(rect);
        }
        // else: too small, discard
    }

    function handleApply() {
        if (!box || box.w <= 0) return;
        onApply({
            xmin: Math.round(box.x),
            ymin: Math.round(box.y),
            xmax: Math.round(box.x + box.w),
            ymax: Math.round(box.y + box.h),
        });
    }

    return (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-elevated w-[95vw] max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="gradient-primary rounded-lg p-2 text-white">
                            <Crosshair size={16} />
                        </div>
                        <h2 className="font-bold text-slate-900">Crop Passport</h2>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>

                {/* Canvas area */}
                <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-100/50" style={{ minHeight: 0 }}>
                    <div className="relative inline-block">
                        <img
                            ref={imgRef}
                            src={imgSrc}
                            alt="Form"
                            onLoad={() => setImgLoaded(true)}
                            className="max-w-full max-h-[72vh] block rounded-lg"
                            draggable={false}
                        />
                        {imgLoaded && (
                            <canvas
                                ref={canvasRef}
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseUp}
                                className="absolute inset-0 w-full h-full cursor-crosshair"
                            />
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
                    <p className="text-xs text-slate-500">
                        Click and drag on the image to select the passport area
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-5 py-2.5 text-sm rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleApply}
                            disabled={!box || box.w <= 0}
                            className="px-5 py-2.5 text-sm rounded-xl gradient-primary text-white font-semibold hover:shadow-lg hover:shadow-primary-500/25 disabled:opacity-40 transition-all"
                        >
                            Apply Crop
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
