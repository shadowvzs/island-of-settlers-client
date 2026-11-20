import { useId } from "react";

import "./rank-chevrons.css";

const CHEVRON = "M2.8 9.6 11.1 1.8a2.8 2.8 0 0 1 3.8 0l8.3 7.8a3.2 3.2 0 0 1-4.4 4.6L13 8.8l-5.8 5.4a3.2 3.2 0 0 1-4.4-4.6Z";

/** Raised gold rank marks. The containing portrait supplies the accessible rank/level text. */
export const RankChevrons = ({ level }: { level: number }) => {
  const id = useId();
  let count = 1;
  if (Number.isFinite(level)) count = Math.max(1, Math.min(3, Math.trunc(level)));
  const height = count * 16 + 2;
  const gradient = `${id}-rank-gold`;
  return (
    <span aria-hidden="true" className="settlement-ui__rank-chevrons" data-rank-level={count}>
      <svg focusable="false" height={height} viewBox={`0 0 26 ${height}`} width="26">
        <defs>
          <linearGradient id={gradient} x1="0" x2=".8" y1="0" y2="1">
            <stop offset="0" stopColor="#fff8b1" />
            <stop offset=".2" stopColor="#ffe86a" />
            <stop offset=".45" stopColor="#ffc900" />
            <stop offset=".74" stopColor="#e7a300" />
            <stop offset="1" stopColor="#a96800" />
          </linearGradient>
        </defs>
        {Array.from({ length: count }, (_, index) => (
          <g data-chevron="" key={index} transform={`translate(0 ${index * 16})`}>
            <path d={CHEVRON} fill="#8d5907" transform="translate(0 1.5)" />
            <path d={CHEVRON} fill={`url(#${gradient})`} stroke="#c08b06" strokeWidth=".45" />
            <path d="M3.4 9.4 11.5 2a2.3 2.3 0 0 1 3 0l8 7.5" fill="none"
              opacity=".8" stroke="#fff2a4" strokeLinecap="round" strokeWidth="1.1" />
          </g>
        ))}
      </svg>
    </span>
  );
};
