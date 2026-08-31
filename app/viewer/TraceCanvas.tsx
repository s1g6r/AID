"use client";

import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";

export type DrawFn = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) => void;

interface TraceCanvasProps extends ComponentPropsWithoutRef<"canvas"> {
  draw: DrawFn;
}

/**
 * A canvas that keeps itself the size of its box, at device pixel density, and
 * redraws whenever its `draw` prop changes or the box resizes.
 *
 * The draw function is held in a ref and assigned in an effect rather than
 * during render, because writing a ref during render is exactly what the React
 * compiler lint rejects.
 */
export function TraceCanvas({ draw, ...rest }: TraceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  const renderRef = useRef<() => void>(() => {});

  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // No dependency array: the canvas is repainted after every render of this
  // component, which only happens when something it draws has changed.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const ratio = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(rect.width * ratio);
      const pixelHeight = Math.round(rect.height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      drawRef.current(ctx, rect.width, rect.height);
    };
    renderRef.current = render;
    render();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => renderRef.current());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  return <canvas ref={canvasRef} {...rest} />;
}
