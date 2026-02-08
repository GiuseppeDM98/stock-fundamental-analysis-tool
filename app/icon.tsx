import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: "linear-gradient(135deg, #0a101f 0%, #1a2540 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Chart line (ascending trend) */}
        <svg
          width="28"
          height="28"
          viewBox="0 0 28 28"
          style={{ position: "absolute", top: 2, left: 2 }}
        >
          {/* Trend line */}
          <polyline
            points="3,22 9,16 15,18 22,7"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Magnifying glass circle */}
          <circle
            cx="18"
            cy="14"
            r="6"
            fill="none"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth="1.8"
          />
          {/* Magnifying glass handle */}
          <line
            x1="22.5"
            y1="18.5"
            x2="26"
            y2="22"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    { ...size }
  );
}
