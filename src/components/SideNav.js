import { useEffect, useRef } from 'react';

// The section menu of the admin panel and the shop dashboard: a grouped list beside the page on computers,
// one row of tabs that scrolls sideways on phones (see .dash-nav in admin.css).
// `groups` is [[heading or null, [[id, label, badge?], …]], …]; `badge` is a count shown in red when above 0.
export default function SideNav({ groups, current, onSelect, label }) {
  const nav = useRef(null);

  // On phones the current section is scrolled into view in the row of tabs (the row only, never the page).
  useEffect(() => {
    const row = nav.current;
    const on = row?.querySelector('button.on');
    if (on && row.scrollWidth > row.clientWidth) row.scrollLeft = on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
  }, [current]);

  return (
    <nav ref={nav} className="card dash-nav" aria-label={label}>
      {groups.map(([group, items]) => (
        <div key={group ?? 'main'} className="dash-nav-group">
          {group && <span className="dash-nav-label">{group}</span>}
          {items.map(([id, name, badge]) => (
            <button
              key={id}
              className={current === id ? 'on' : ''}
              onClick={() => onSelect(id)}
              aria-current={current === id ? 'page' : undefined}
            >
              {name}
              {badge > 0 && <span className="badge-inline">{badge}</span>}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
