import type { CSSProperties } from "react";

export function SoundWaveGlyph({
  active,
  size = 24,
}: {
  active: boolean;
  size?: number;
}) {
  const barWidth = Math.max(2, Math.round(size * 0.12));
  const gap = Math.max(2, Math.round(size * 0.08));
  const heights = [0.42, 0.72, 1, 0.64];
  const viewBoxWidth = barWidth * heights.length + gap * (heights.length - 1);

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={`0 0 ${viewBoxWidth} 24`}
      fill="none"
      style={glyphStyle}
    >
      {heights.map((scale, index) => {
        const height = Math.max(6, Math.round(16 * scale));
        const y = (24 - height) / 2;
        const x = index * (barWidth + gap);
        const minHeight = Math.max(5, Math.round(height * 0.45));
        const minY = (24 - minHeight) / 2;
        return (
          <rect
            key={index}
            x={x}
            y={active ? minY : y}
            width={barWidth}
            height={active ? minHeight : height}
            rx={barWidth / 2}
            fill="currentColor"
            opacity={active ? 1 : 0.9}
          >
            {active ? (
              <>
                <animate
                  attributeName="height"
                  values={`${minHeight};${height};${Math.max(minHeight + 1, Math.round(height * 0.7))};${minHeight}`}
                  dur={`${0.9 + index * 0.12}s`}
                  begin={`${index * 0.08}s`}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="y"
                  values={`${minY};${y};${(24 - Math.max(minHeight + 1, Math.round(height * 0.7))) / 2};${minY}`}
                  dur={`${0.9 + index * 0.12}s`}
                  begin={`${index * 0.08}s`}
                  repeatCount="indefinite"
                />
              </>
            ) : null}
          </rect>
        );
      })}
    </svg>
  );
}

const glyphStyle: CSSProperties = {
  display: "block",
  flexShrink: 0,
};
