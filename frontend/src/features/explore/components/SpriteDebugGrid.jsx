import React from 'react';
import BibleEventSprite from './BibleEventSprite.jsx';

/**
 * Visual regression grid for all 50 sprite crops. Shown when `?spriteDebug=1` in dev.
 */
export default function SpriteDebugGrid() {
  const variants = ['list', 'popover', 'strip', 'pin', 'drawer', 'hero'];
  return (
    <div className="sprite-debug">
      <header className="sprite-debug__head">
        <h2>Sprite debug (orders 1–50)</h2>
        <p>Remove <code>?spriteDebug=1</code> from the URL to hide. Title band on sheets must not appear inside crops.</p>
      </header>
      {variants.map((v) => (
        <section key={v} className="sprite-debug__section">
          <h3>{v}</h3>
          <div className="sprite-debug__row">
            {Array.from({ length: 50 }, (_, i) => (
              <div key={`${v}-${i + 1}`} className="sprite-debug__cell" title={`Order ${i + 1}`}>
                <BibleEventSprite order={i + 1} variant={v} />
                <span className="sprite-debug__label">{i + 1}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
