import React from 'react';

// Faithful port of the icon set used across the Grove design comps.
// Each entry is a list of path/shape definitions; "circle:cx,cy,r" and
// "rect:x,y,w,h,rx" are shorthands, everything else is an SVG path `d`.
const DEFS: Record<string, string[]> = {
  home: ['M3 11l9-8 9 8', 'M5 10v10h14V10'],
  strategy: ['circle:12,12,8.5', 'circle:12,12,4', 'M12 1v3', 'M12 20v3', 'M1 12h3', 'M20 12h3'],
  write: ['M4 20l3.5-1 10-10a2 2 0 00-3-3l-10 10z', 'M13.5 6.5l3 3'],
  pen: ['M4 20l3.5-1 10-10a2 2 0 00-3-3l-10 10z', 'M13.5 6.5l3 3'],
  pipeline: ['M4 7h16', 'M4 12h16', 'M4 17h10'],
  calendar: ['rect:3,5,18,16,2', 'M3 9h18', 'M8 3v4', 'M16 3v4'],
  reviews: ['circle:12,12,9', 'M8.5 12l2.4 2.4L15.5 9'],
  analytics: ['M5 21V11', 'M12 21V4', 'M19 21v-7', 'M3 21h18'],
  voice: ['M4 10v4', 'M8 6v12', 'M12 9v6', 'M16 4v16', 'M20 10v4'],
  social: ['circle:6,12,2.5', 'circle:18,6,2.5', 'circle:18,18,2.5', 'M8.2 10.8l7.6-3.6', 'M8.2 13.2l7.6 3.6'],
  channels: ['circle:6,12,2.5', 'circle:18,6,2.5', 'circle:18,18,2.5', 'M8.2 10.8l7.6-3.6', 'M8.2 13.2l7.6 3.6'],
  embed: ['M9 8l-4 4 4 4', 'M15 8l4 4-4 4'],
  bell: ['M6 9a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6', 'M10.5 20a2 2 0 003 0'],
  check: ['M20 6L9 17l-5-5'],
  tick: ['M20 6L9 17l-5-5'],
  compass: ['circle:12,12,9', 'M16 8l-2.4 5.6L8 16l2.4-5.6z'],
  back: ['M19 12H5', 'M12 19l-7-7 7-7'],
  chevL: ['M15 18l-6-6 6-6'],
  chevR: ['M9 18l6-6-6-6'],
  caret: ['M9 18l6-6-6-6'],
  refresh: ['M21 12a9 9 0 01-9 9 9 9 0 01-6.7-3M3 12a9 9 0 019-9 9 9 0 016.7 3', 'M21 3v5h-5', 'M3 21v-5h5'],
  eye: ['circle:12,12,3', 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z'],
  target: ['circle:12,12,8', 'circle:12,12,3.5'],
  spark: ['M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z'],
  sparkle: ['M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z'],
  billing: ['rect:2.5,5,19,14,2.5', 'M2.5 9.5h19', 'M6 14.5h4'],
  q: ['circle:12,12,9', 'M9.2 9.2a2.8 2.8 0 015.4 1c0 1.9-2.8 2.3-2.8 4', 'M12 17.5v.2'],
  image: ['rect:3,4,18,16,2', 'circle:8.5,9.5,1.8', 'M21 16l-5-5L5 20'],
  x: ['M4 4l16 16', 'M20 4L4 20'],
  linkedin: ['rect:3,3,18,18,2', 'M7 10v7', 'M7 7v.01', 'M11 17v-4a2 2 0 014 0v4', 'M11 17v-7'],
  instagram: ['rect:3,3,18,18,5', 'circle:12,12,4', 'M17.5 6.5v.01'],
  leaf: ['M11 20c-4 0-7-3-7-8 0-5 6-9 15-9 0 9-4 15-9 15-3 0-4-2-4-4 0-3 3-5 7-6'],
  doc: ['M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z', 'M14 3v5h5'],
  globe: ['circle:12,12,9', 'M3 12h18', 'M12 3c2.5 2.8 2.5 15.2 0 18', 'M12 3c-2.5 2.8-2.5 15.2 0 18'],
  published: ['circle:12,12,9', 'M3 12h18', 'M12 3c2.6 2.8 2.6 15.2 0 18', 'M12 3c-2.6 2.8-2.6 15.2 0 18'],
  search2: ['circle:11,11,7', 'M21 21l-3.5-3.5'],
  search: ['circle:11,11,7', 'M21 21l-3.6-3.6'],
  alert: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17.5v.2'],
  note: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17.5v.2'],
  download: ['M12 4v11', 'M7 11l5 5 5-5', 'M5 20h14'],
  cursor: ['M4 4l7 16 2.5-6.5L20 11z'],
  clock: ['circle:12,12,9', 'M12 7v5l3 2'],
  send: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4z'],
  edit: ['M4 20l3.5-1 10-10a2 2 0 00-3-3l-10 10z', 'M13.5 6.5l3 3'],
  link: ['M9 15l6-6', 'M11 6l1-1a4 4 0 016 6l-1 1', 'M13 18l-1 1a4 4 0 01-6-6l1-1'],
  domains: ['M9 15l6-6', 'M11 6l1-1a4 4 0 016 6l-1 1', 'M13 18l-1 1a4 4 0 01-6-6l1-1'],
  bolt: ['M13 2L4.5 13.5H11l-1 8.5L19.5 10.5H13z'],
  book: ['M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z', 'M19 19v2'],
  answers: ['M12 3l2.2 5.6L20 11l-5.8 2.4L12 19l-2.2-5.6L4 11l5.8-2.4z'],
  rankings: ['M3 17l5-5 4 4 8-8', 'M16 8h5v5'],
  overview: ['rect:3,3,7,7', 'rect:14,3,7,7', 'rect:14,14,7,7', 'rect:3,14,7,7'],
  settings: ['M4 7h11', 'M19 7h1', 'M4 17h5', 'M13 17h7', 'circle:17,7,2', 'circle:11,17,2'],
  gauge: ['M12 13l4-4', 'M5.5 18a8 8 0 1113 0z'],
  trash: ['M4 7h16', 'M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13', 'M9 7V4h6v3'],
  chevron: ['M6 9l6 6 6-6'],
  view: ['M14 5h5v5', 'M19 5l-8 8', 'M9 5H5v14h14v-4'],
};

export default function Icon({ name, size = 17 }: { name: string; size?: number }) {
  const els = (DEFS[name] || []).map((d, i) => {
    if (d.startsWith('circle:')) {
      const a = d.slice(7).split(',');
      return <circle key={i} cx={+a[0]} cy={+a[1]} r={+a[2]} />;
    }
    if (d.startsWith('rect:')) {
      const a = d.slice(5).split(',');
      return <rect key={i} x={+a[0]} y={+a[1]} width={+a[2]} height={+a[3]} rx={a[4] ? +a[4] : 1.5} />;
    }
    return <path key={i} d={d} />;
  });
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {els}
    </svg>
  );
}
