/* ============================================================
   Nothing here is required. artwork runs on six open sources
   that need no account at all.

   A few collections do want a key. Drop one in below and its
   shelves appear in the playlist drawer by themselves; leave it
   empty and nothing anywhere refers to it.

   · Harvard Art Museums — 235,000 works.
     Free key, granted by email in a minute or two:
     https://harvardartmuseums.org/collections/api

   Keep in mind that a key in a static site is a key in public.
   Use one that is free, read-only and rate-limited — which is
   exactly what Harvard hands out — and never a paid one.
   ============================================================ */
export const KEYS = {
  harvard: '',
};

export const has = name => Boolean(KEYS[name]);
