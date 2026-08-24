import { useState, useRef, useEffect } from "react";
import { Plus, Minus, Maximize, RotateCw } from "lucide-react";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const CLICK_ZOOM = 2.5;
const STEP = 1.5;

/**
 * Zoomable/pannable image viewer for the scanned form pane.
 * - Click zooms in centred on the cursor; click again zooms back out.
 * - Drag pans while zoomed. Ctrl+scroll zooms smoothly, plain scroll pans.
 * - Floating controls: zoom in/out, fit, rotate (90° CW, handled by parent).
 */
export default function ImageViewer({ src, onRotate, rotateDisabled }) {
    const containerRef = useRef(null);
    const imgRef = useRef(null);
    const dragRef = useRef(null);
    const [t, setT] = useState({ z: 1, x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);

    /** Zoom to targetZ keeping the image point under (clientX, clientY) fixed. */
    function zoomAt(clientX, clientY, targetZ) {
        const img = imgRef.current;
        if (!img) return;
        const z2 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetZ));
        if (z2 <= 1) { setT({ z: 1, x: 0, y: 0 }); return; }
        const rect = img.getBoundingClientRect(); // transformed rect; origin is top-left
        const px = (clientX - rect.left) / t.z;
        const py = (clientY - rect.top) / t.z;
        setT({
            z: z2,
            x: clientX - (rect.left - t.x) - px * z2,
            y: clientY - (rect.top - t.y) - py * z2,
        });
    }

    function zoomStep(factor) {
        const c = containerRef.current;
        if (!c) return;
        const rect = c.getBoundingClientRect();
        zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, t.z * factor);
    }

    function handleMouseDown(e) {
        if (e.button !== 0) return;
        dragRef.current = { sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y, moved: false };
        if (t.z > 1) setDragging(true);
    }

    function handleMouseMove(e) {
        const d = dragRef.current;
        if (!d) return;
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
        if (d.moved && t.z > 1) setT((s) => ({ ...s, x: d.ox + dx, y: d.oy + dy }));
    }

    function handleMouseUp(e) {
        const d = dragRef.current;
        dragRef.current = null;
        setDragging(false);
        if (!d || d.moved) return;
        // Plain click: toggle zoom at cursor
        if (t.z === 1) zoomAt(e.clientX, e.clientY, CLICK_ZOOM);
        else setT({ z: 1, x: 0, y: 0 });
    }

    function handleMouseLeave() {
        dragRef.current = null;
        setDragging(false);
    }

    // Native wheel listener — React's onWheel is passive, preventDefault needs this
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onWheel = (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                zoomAt(e.clientX, e.clientY, t.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
            } else if (t.z > 1) {
                e.preventDefault();
                setT((s) => ({ ...s, y: s.y - e.deltaY }));
            }
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [t]); // re-register only when zoom/pan state changes, not on every parent re-render

    const cursor = t.z === 1 ? "cursor-zoom-in" : dragging ? "cursor-grabbing" : "cursor-zoom-out";

    return (
        <div
            ref={containerRef}
            className={`relative w-full h-full overflow-hidden flex items-center justify-center p-4 select-none ${cursor}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
        >
            <img
                ref={imgRef}
                src={src}
                alt="Scanned form"
                draggable={false}
                className="max-w-full max-h-full object-contain rounded-lg"
                style={{
                    transform: `translate(${t.x}px, ${t.y}px) scale(${t.z})`,
                    transformOrigin: "0 0",
                    transition: dragging ? "none" : "transform 0.15s ease-out",
                }}
            />

            {/* Floating controls */}
            <div
                className="absolute bottom-4 right-4 flex flex-col gap-1.5"
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
            >
                {t.z > 1 && (
                    <span className="text-center text-[11px] font-mono font-semibold text-slate-300 bg-slate-800/80 backdrop-blur-sm rounded-lg py-1">
                        {Math.round(t.z * 100)}%
                    </span>
                )}
                <ViewerButton title="Zoom in" onClick={() => zoomStep(STEP)}><Plus size={16} /></ViewerButton>
                <ViewerButton title="Zoom out" onClick={() => zoomStep(1 / STEP)}><Minus size={16} /></ViewerButton>
                <ViewerButton title="Fit to screen" onClick={() => setT({ z: 1, x: 0, y: 0 })}><Maximize size={15} /></ViewerButton>
                {onRotate && (
                    <ViewerButton title="Rotate 90° clockwise (clears passport crop)" onClick={onRotate} disabled={rotateDisabled} accent>
                        <RotateCw size={15} />
                    </ViewerButton>
                )}
            </div>
        </div>
    );
}

function ViewerButton({ children, onClick, title, disabled, accent }) {
    return (
        <button
            type="button"
            title={title}
            disabled={disabled}
            onClick={onClick}
            className={`p-2.5 rounded-lg backdrop-blur-sm border transition-all disabled:opacity-40 ${
                accent
                    ? "bg-primary-600/80 border-primary-500/40 text-white hover:bg-primary-500"
                    : "bg-slate-800/80 border-slate-700/50 text-slate-200 hover:bg-slate-700 hover:text-white"
            }`}
        >
            {children}
        </button>
    );
}
