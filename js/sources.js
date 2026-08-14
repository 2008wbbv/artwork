/* ============================================================
   Three open collections, no keys, no server, CORS-friendly:
     · Art Institute of Chicago   api.artic.edu           (CC0)
     · The Metropolitan Museum    collectionapi.metmuseum.org
     · Cleveland Museum of Art    openaccess-api.clevelandart.org
   Each adapter returns the same shape so the rest of the app
   never has to know where a picture came from.
   ============================================================ */
import { fetchJSON, pool, plain, shuffle } from './util.js';

const NATIONS = ['French','Dutch','German','Italian','British','English','Scottish','Irish','American',
  'Spanish','Japanese','Chinese','Korean','Flemish','Belgian','Austrian','Russian','Swedish','Norwegian',
  'Danish','Finnish','Swiss','Mexican','Indian','Persian','Iranian','Greek','Polish','Hungarian','Czech',
  'Canadian','Australian','Brazilian','Argentine','Turkish','Egyptian','Portuguese','Netherlandish','Venetian'];

function nationalityFrom(...bits) {
  const hay = bits.filter(Boolean).join(' ');
  for (const n of NATIONS) if (new RegExp(`\\b${n}\\b`, 'i').test(hay)) return n;
  return '';
}

/** IIIF and friends: ask each host for the largest size worth downloading */
export function targetWidth() {
  const long = Math.max(window.innerWidth, window.innerHeight);
  const w = Math.round(long * Math.min(window.devicePixelRatio || 1, 2));
  return w > 1400 ? 1686 : w > 1000 ? 1200 : 843;
}

const yearOf = s => {
  const m = String(s || '').match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  return m ? +m[1] : null;
};

function finish(a) {
  a.year = a.year || yearOf(a.date);
  a.century = a.year ? Math.floor((a.year - 1) / 100) + 1 : null;
  a.nationality = a.nationality || nationalityFrom(a.artistBio, a.place, a.culture);
  a.searchText = [a.title, a.artist, a.artistBio, a.place, a.culture, a.medium, a.note, a.classification, a.department]
    .filter(Boolean).join(' · ').toLowerCase();
  return a;
}

/* ---------------------------------------------------------- AIC */
const AIC_FIELDS = ['id','title','artist_display','artist_title','date_display','place_of_origin','medium_display',
  'dimensions','credit_line','image_id','thumbnail','artwork_type_title','classification_title','style_title',
  'department_title','description','gallery_title','is_public_domain','color'].join(',');

function fromAIC(d) {
  if (!d?.image_id) return null;
  const th = d.thumbnail || {};
  return finish({
    key: 'aic:' + d.id,
    src: 'aic',
    museum: 'Art Institute of Chicago',
    museumShort: 'Art Institute of Chicago',
    city: 'Chicago',
    title: d.title || 'Untitled',
    artist: d.artist_title || (d.artist_display || '').split(/[,(\n]/)[0].trim() || 'Unknown',
    artistBio: (d.artist_display || '').replace(/\n/g, ' '),
    date: d.date_display || '',
    medium: d.medium_display || '',
    dims: d.dimensions || '',
    credit: d.credit_line || '',
    place: d.place_of_origin || '',
    culture: '',
    style: d.style_title || '',
    classification: d.artwork_type_title || d.classification_title || '',
    department: d.department_title || '',
    gallery: d.gallery_title || '',
    note: plain(d.description) || plain(th.alt_text, 150),
    alt: plain(th.alt_text, 220) || d.title,
    url: `https://www.artic.edu/artworks/${d.id}`,
    lqip: th.lqip || '',
    ratio: th.width && th.height ? th.width / th.height : 0,
    image: w => `https://www.artic.edu/iiif/2/${d.image_id}/full/${w},/0/default.jpg`,
    hiRes: `https://www.artic.edu/iiif/2/${d.image_id}/full/2400,/0/default.jpg`,
  });
}

async function aicSearch({ q = '', term, limit = 90, page = 1 }, signal) {
  const p = new URLSearchParams({ fields: AIC_FIELDS, limit: String(limit), page: String(page) });
  if (q) p.set('q', q);
  // the API accepts exactly one term filter, so public-domain vs. curator-boosted is a choice
  if (term) p.set(`query[term][${term.field}]`, String(term.value));
  else p.set('query[term][is_public_domain]', 'true');
  const j = await fetchJSON(`https://api.artic.edu/api/v1/artworks/search?${p}`, { signal });
  return (j.data || [])
    .filter(d => d.is_public_domain !== false)
    .map(fromAIC).filter(Boolean);
}

/* ---------------------------------------------------------- MET */
function fromMET(d) {
  const img = d.primaryImageSmall || d.primaryImage;
  if (!img || !d.isPublicDomain) return null;
  return finish({
    key: 'met:' + d.objectID,
    src: 'met',
    museum: 'The Metropolitan Museum of Art',
    museumShort: 'The Met',
    city: 'New York',
    title: d.title || 'Untitled',
    artist: d.artistDisplayName || d.culture || 'Unknown',
    artistBio: d.artistDisplayBio || '',
    nationality: d.artistNationality || '',
    date: d.objectDate || '',
    year: d.objectBeginDate || null,
    medium: d.medium || '',
    dims: d.dimensions || '',
    credit: d.creditLine || '',
    place: [d.city, d.country, d.region].filter(Boolean).join(', '),
    culture: d.culture || '',
    style: d.period || '',
    classification: d.classification || d.objectName || '',
    department: d.department || '',
    gallery: d.GalleryNumber ? `Gallery ${d.GalleryNumber}` : '',
    note: '',
    alt: [d.title, d.artistDisplayName].filter(Boolean).join(', '),
    url: d.objectURL || `https://www.metmuseum.org/art/collection/search/${d.objectID}`,
    lqip: '',
    ratio: 0,
    image: () => img,
    hiRes: d.primaryImage && d.primaryImage !== img ? d.primaryImage : '',
  });
}

async function metSearch({ params = {}, take = 34 }, signal) {
  const p = new URLSearchParams({ hasImages: 'true', ...params });
  const j = await fetchJSON(`https://collectionapi.metmuseum.org/public/collection/v1/search?${p}`, { signal });
  const ids = shuffle(j.objectIDs || []).slice(0, take);
  const objs = await pool(ids, 6, id =>
    fetchJSON(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, { signal, timeout: 11000 }));
  return objs.map(fromMET).filter(Boolean);
}

/* ---------------------------------------------------------- CMA */
function fromCMA(d) {
  const img = d.images?.web?.url || d.images?.print?.url;
  if (!img) return null;
  const maker = (d.creators || [])[0] || {};
  const iw = +(d.images?.web?.width || 0), ih = +(d.images?.web?.height || 0);
  return finish({
    key: 'cma:' + d.id,
    src: 'cma',
    museum: 'Cleveland Museum of Art',
    museumShort: 'Cleveland Museum of Art',
    city: 'Cleveland',
    title: d.title || 'Untitled',
    artist: (maker.description || '').split('(')[0].trim() || 'Unknown',
    artistBio: maker.description || '',
    date: d.creation_date || '',
    year: d.creation_date_earliest || null,
    medium: d.technique || '',
    dims: d.measurements || '',
    credit: (d.tombstone || '').split('. ').slice(-1)[0] || '',
    place: (d.culture || [])[0] || '',
    culture: (d.culture || []).join(', '),
    style: '',
    classification: d.type || '',
    department: d.department || '',
    gallery: d.current_location || '',
    note: plain(d.wall_description || d.description),
    alt: [d.title, maker.description].filter(Boolean).join(', '),
    url: d.url || `https://www.clevelandart.org/art/${d.accession_number}`,
    lqip: '',
    ratio: iw && ih ? iw / ih : 0,
    image: () => img,
    hiRes: d.images?.print?.url || '',
  });
}

async function cmaSearch({ params = {}, limit = 40 }, signal) {
  const p = new URLSearchParams({ has_image: '1', cc0: '1', limit: String(limit), ...params });
  const j = await fetchJSON(`https://openaccess-api.clevelandart.org/api/artworks/?${p}`, { signal });
  return (j.data || []).map(fromCMA).filter(Boolean);
}

/* ---------------------------------------------------------- V&A */
const VAM_KIND = /painting|watercolour|water-colour|drawing|print|gouache|tempera|miniature|etching|engraving|lithograph|woodblock|woodcut/i;
const VAM_FLIP = n => (n && n.includes(',') ? n.split(',').map(x => x.trim()).reverse().join(' ') : n || '');

function fromVAM(d) {
  const base = d._images?._iiif_image_base_url;
  if (!base) return null;
  const maker = VAM_FLIP(d._primaryMaker?.name);
  return finish({
    key: 'vam:' + d.systemNumber,
    src: 'vam',
    museum: 'Victoria and Albert Museum',
    museumShort: 'The V&A',
    city: 'London',
    title: d._primaryTitle || d.objectType || 'Untitled',
    artist: maker || 'Unknown',
    artistBio: [maker, d._primaryPlace].filter(Boolean).join(', '),
    date: d._primaryDate || '',
    medium: d.objectType || '',
    dims: '',
    credit: d._currentLocation?.displayName || '',
    place: d._primaryPlace || '',
    culture: '',
    style: '',
    classification: d.objectType || '',
    department: '',
    gallery: d._currentLocation?.displayName || '',
    note: '',
    alt: [d._primaryTitle, maker].filter(Boolean).join(', '),
    url: `https://collections.vam.ac.uk/item/${d.systemNumber}/`,
    lqip: '',
    ratio: 0,
    image: w => `${base}full/!${w},${w}/0/default.jpg`,
    hiRes: `${base}full/!2400,2400/0/default.jpg`,
  });
}

async function vamSearch({ params = {}, limit = 45 }, signal) {
  const p = new URLSearchParams({
    images_exist: '1', page_size: String(limit), response_format: 'json',
    year_made_to: '1920', ...params,
  });
  const j = await fetchJSON(`https://api.vam.ac.uk/v2/objects/search?${p}`, { signal });
  return (j.records || []).map(fromVAM).filter(Boolean).filter(a => VAM_KIND.test(a.classification));
}

/* ---------------------------------------------------------- SMK */
const DANISH = { Dansk:'Danish', Italiensk:'Italian', Fransk:'French', Tysk:'German', Hollandsk:'Dutch',
  Nederlandsk:'Dutch', Engelsk:'British', Britisk:'British', Spansk:'Spanish', Flamsk:'Flemish',
  Norsk:'Norwegian', Svensk:'Swedish', Belgisk:'Belgian', Østrigsk:'Austrian', Russisk:'Russian',
  Amerikansk:'American', Japansk:'Japanese', Schweizisk:'Swiss', Polsk:'Polish' };

function fromSMK(d) {
  const iiif = d.image_iiif_id;
  const flat = d.image_thumbnail || d.image_native;
  if ((!iiif && !flat) || d.public_domain === false) return null;
  if (!iiif && +(d.image_width || 0) < 800) return null;      // a thumbnail is not a painting
  const maker = (d.production || [])[0] || {};
  const name = maker.creator_forename && maker.creator_surname
    ? `${maker.creator_forename} ${maker.creator_surname}`
    : (maker.creator || '').split(',').map(x => x.trim()).reverse().join(' ');
  const titles = d.titles || [];
  const t = titles.find(x => x.language === 'engelsk') || titles[0] || {};
  const life = [maker.creator_date_of_birth, maker.creator_date_of_death]
    .map(x => (x ? String(x).slice(0, 4) : '')).filter(Boolean).join('–');
  return finish({
    key: 'smk:' + d.object_number,
    src: 'smk',
    museum: 'Statens Museum for Kunst',
    museumShort: 'SMK, Copenhagen',
    city: 'Copenhagen',
    title: (t.title || 'Uden titel').slice(0, 160),
    artist: name || 'Unknown',
    artistBio: [name, life].filter(Boolean).join(', '),
    nationality: DANISH[maker.creator_nationality] || '',
    date: (d.production_date || [])[0]?.period || '',
    medium: (d.techniques || [])[0] || (d.object_names || [])[0]?.name || '',
    dims: '',
    credit: d.credit_line || '',
    place: '',
    culture: DANISH[maker.creator_nationality] || maker.creator_nationality || '',
    style: '',
    classification: (d.object_names || [])[0]?.name || '',
    department: d.responsible_department || '',
    gallery: d.current_location_name || '',
    note: '',
    alt: [t.title, name].filter(Boolean).join(', '),
    url: `https://open.smk.dk/artwork/image/${d.object_number}`,
    lqip: '',
    ratio: +d.image_width && +d.image_height ? +d.image_width / +d.image_height : 0,
    image: w => (iiif ? `${iiif}/full/!${w},/0/default.jpg` : flat),
    hiRes: iiif ? `${iiif}/full/!2600,/0/default.jpg` : '',
  });
}

async function smkSearch({ params = {}, limit = 40 }, signal) {
  const p = new URLSearchParams({
    keys: '*', filters: '[has_image:true],[public_domain:true]',
    offset: '0', rows: String(limit), lang: 'en', ...params,
  });
  const j = await fetchJSON(`https://api.smk.dk/api/v1/art/search/?${p}`, { signal });
  return (j.items || []).map(fromSMK).filter(Boolean);
}

/* ---------------------------------------------------------- */
const SOURCES = {
  aic: { name: 'Art Institute of Chicago', run: aicSearch },
  met: { name: 'The Met', run: metSearch },
  cma: { name: 'Cleveland Museum of Art', run: cmaSearch },
  vam: { name: 'Victoria and Albert Museum', run: vamSearch },
  smk: { name: 'Statens Museum for Kunst', run: smkSearch },
};

/** run one query spec from a playlist */
export async function runQuery(spec, signal) {
  const source = SOURCES[spec.src];
  if (!source) return [];
  const items = await source.run(spec, signal);
  const wanted = spec.types;
  return items.filter(a => {
    if (a.ratio && (a.ratio > 3.6 || a.ratio < 0.34)) return false;  // scrolls and friezes read badly full-bleed
    if (!wanted) return true;
    return wanted.some(t => (a.classification || '').toLowerCase().includes(t.toLowerCase()));
  });
}

/** load an <img> for the canvas; falls back to a tainted load if CORS is refused */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const attempt = anon => {
      const img = new Image();
      if (anon) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      // decode off the main thread, so the first stroke doesn't cost a dropped second
      img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())
        .then(() => resolve({ img, tainted: !anon }));
      img.onerror = () => (anon ? attempt(false) : reject(new Error('image failed: ' + url)));
      img.src = url;
    };
    attempt(true);
  });
}

