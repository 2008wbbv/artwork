/* ============================================================
   Playlists — the shelf you choose from. Each one is a set of
   queries across the three collections; results are merged,
   de-duplicated and shuffled into a viewing order.
   `tags` are handed to the badge ledger, because a museum record
   rarely says "impressionism" out loud.
   ============================================================ */

import { has } from './keys.js';

export const GROUPS = ['Curated', 'Movements', 'Artists', 'Places', 'Museums'];

export const PLAYLISTS = [
  /* ---------------------------------------------------- Curated */
  { id:'the-ten', group:'Curated', name:'The Ten', note:'The pictures the curators themselves put a star beside.',
    tags:['highlight'], queries:[
      { src:'aic', term:{ field:'is_boosted', value:true }, limit:100 },
      { src:'met', params:{ isHighlight:'true', medium:'Paintings', q:'painting' }, take:30 },
    ]},

  { id:'sum-of-paintings', group:'Curated', name:'The Sum of All Paintings', note:'The great houses of Europe, by way of Wikidata and Wikimedia Commons.',
    tags:['highlight'], rand:true, queries:[
      { src:'wd', filter:'VALUES ?coll { wd:Q190804 wd:Q160112 wd:Q19675 wd:Q180788 wd:Q51252 wd:Q132783 wd:Q23402 wd:Q95569 wd:Q221092 } ?item wdt:P195 ?coll .', limit:50 },
    ]},

  { id:'blue-hour', group:'Curated', name:'Blue Hour', note:'Nocturnes, moonlight, lamplit windows — painting after dark.',
    tags:['night'], queries:[
      { src:'aic', q:'nocturne night moonlight', types:['Painting'], limit:80 },
      { src:'met', params:{ q:'night', medium:'Paintings' }, take:26 },
      { src:'cma', params:{ q:'night', type:'Painting' }, limit:30 },
    ]},

  { id:'quiet-rooms', group:'Curated', name:'Quiet Rooms', note:'Interiors. Somebody has just left, or is about to arrive.',
    tags:['interior'], queries:[
      { src:'aic', q:'interior room window figure reading', types:['Painting'], limit:80 },
      { src:'met', params:{ q:'interior', medium:'Paintings' }, take:26 },
      { src:'cma', params:{ q:'interior', type:'Painting' }, limit:30 },
    ]},

  { id:'still-life', group:'Curated', name:'Still Life, Slowly', note:'Fruit, glass, cloth and light. Nothing is going to move.',
    tags:['still-life'], queries:[
      { src:'aic', q:'still life', types:['Painting'], limit:80 },
      { src:'met', params:{ q:'still life', medium:'Paintings' }, take:26 },
      { src:'cma', params:{ q:'still life', type:'Painting' }, limit:30 },
    ]},

  { id:'gardens', group:'Curated', name:'Gardens & Green', note:'Where painters go when the studio gets too small.',
    tags:['garden'], queries:[
      { src:'aic', q:'garden flowers park', types:['Painting'], limit:80 },
      { src:'met', params:{ q:'garden', medium:'Paintings' }, take:26 },
      { src:'cma', params:{ q:'garden', type:'Painting' }, limit:30 },
    ]},

  /* -------------------------------------------------- Movements */
  { id:'impressionism', group:'Movements', name:'Impression, and After', note:'Paint out of doors, quickly, before the light turns.',
    tags:['impressionism'], queries:[
      { src:'aic', q:'impressionism impressionist', types:['Painting'], limit:90 },
      { src:'met', params:{ q:'impressionism', medium:'Paintings', dateBegin:'1860', dateEnd:'1910' }, take:30 },
      { src:'cma', params:{ q:'impressionism', type:'Painting' }, limit:30 },
      { src:'wd', filter:'?item wdt:P135 wd:Q40415 .', limit:40 },
    ]},

  { id:'post-impressionism', group:'Movements', name:'After the Impression', note:'Van Gogh, Cézanne, Gauguin — colour let off the leash.',
    tags:['post-impressionism'], queries:[
      { src:'aic', q:'post-impressionism van gogh cezanne gauguin seurat', types:['Painting'], limit:90 },
      { src:'met', params:{ q:'post-impressionism', medium:'Paintings', dateBegin:'1880', dateEnd:'1915' }, take:28 },
    ]},

  { id:'dutch-golden-age', group:'Movements', name:'The Dutch Golden Age', note:'Seventeenth-century Holland: weather, linen, herring, light.',
    tags:['dutch-golden-age'], queries:[
      { src:'aic', q:'dutch seventeenth century rembrandt hals', types:['Painting'], limit:80 },
      { src:'met', params:{ q:'Dutch', medium:'Paintings', dateBegin:'1600', dateEnd:'1700' }, take:32 },
      { src:'cma', params:{ q:'dutch', type:'Painting', created_after:'1600', created_before:'1700' }, limit:30 },
      { src:'wd', filter:'?item wdt:P135 wd:Q1474884 .', limit:40 },
    ]},

  { id:'ukiyo-e', group:'Movements', name:'The Floating World', note:'Ukiyo-e — Edo woodblock, cut and printed by hand.',
    tags:['japan','ukiyo-e'], queries:[
      { src:'aic', q:'ukiyo-e japanese woodblock print', limit:90 },
      { src:'met', params:{ q:'ukiyo-e', medium:'Prints' }, take:30 },
      { src:'cma', params:{ q:'ukiyo-e', department:'Japanese Art' }, limit:30 },
      { src:'vam', params:{ q:'Japanese woodblock print' }, limit:30 },
    ]},

  { id:'baroque', group:'Movements', name:'Baroque & Candlelight', note:'High drama, deep shadow, a single unforgiving light source.',
    tags:['baroque'], queries:[
      { src:'aic', q:'baroque', types:['Painting'], limit:80 },
      { src:'met', params:{ q:'baroque', medium:'Paintings', dateBegin:'1600', dateEnd:'1750' }, take:30 },
      { src:'cma', params:{ q:'baroque', type:'Painting' }, limit:30 },
    ]},

  { id:'romantics', group:'Movements', name:'Romantics & the Sublime', note:'Storms, ruins, and very small people in very large weather.',
    tags:['romanticism'], queries:[
      { src:'aic', q:'romanticism storm shipwreck ruins sublime landscape', types:['Painting'], limit:80 },
      { src:'met', params:{ q:'romanticism', medium:'Paintings', dateBegin:'1790', dateEnd:'1870' }, take:28 },
      { src:'vam', params:{ q:'storm sublime landscape', year_made_to:'1880' }, limit:26 },
    ]},

  { id:'vienna-1900', group:'Movements', name:'Vienna 1900', note:'Secession, gold leaf, and the nervous edge of a century.',
    tags:['vienna','art-nouveau'], queries:[
      { src:'aic', q:'klimt schiele vienna secession art nouveau', limit:70 },
      { src:'met', params:{ q:'Vienna Secession Klimt Schiele' }, take:26 },
    ]},

  { id:'american-light', group:'Movements', name:'American Light', note:'Hudson River, luminism, and the long American afternoon.',
    tags:['american'], queries:[
      { src:'aic', q:'hudson river school american landscape luminism', types:['Painting'], limit:80 },
      { src:'met', params:{ q:'Hudson River School', medium:'Paintings' }, take:28 },
      { src:'cma', params:{ q:'american landscape', type:'Painting' }, limit:26 },
    ]},

  /* ---------------------------------------------------- Artists */
  { id:'monet', group:'Artists', name:'Claude Monet', note:'The same haystack, the same cathedral, a different hour.',
    tags:['impressionism','french'], queries:[
      { src:'aic', q:'Claude Monet', types:['Painting'], limit:60 },
      { src:'met', params:{ q:'Claude Monet', artistOrCulture:'true' }, take:26 },
      { src:'cma', params:{ artists:'Claude Monet' }, limit:20 },
      { src:'wd', filter:'?item wdt:P170 wd:Q296 .', limit:36 },
    ]},

  { id:'van-gogh', group:'Artists', name:'Vincent van Gogh', note:'Ten years of painting, most of it in the last four.',
    tags:['post-impressionism','dutch'], queries:[
      { src:'aic', q:'Vincent van Gogh', limit:60 },
      { src:'met', params:{ q:'Vincent van Gogh', artistOrCulture:'true' }, take:26 },
      { src:'cma', params:{ artists:'Vincent van Gogh' }, limit:20 },
      { src:'wd', filter:'?item wdt:P170 wd:Q5582 .', limit:36 },
    ]},

  { id:'hokusai', group:'Artists', name:'Hokusai & Hiroshige', note:'Fuji from thirty-six angles; the road east in fifty-three stops.',
    tags:['japan','ukiyo-e'], queries:[
      { src:'aic', q:'Hokusai Hiroshige', limit:70 },
      { src:'met', params:{ q:'Hokusai', artistOrCulture:'true' }, take:20 },
      { src:'met', params:{ q:'Hiroshige', artistOrCulture:'true' }, take:20 },
    ]},

  { id:'vermeer-delft', group:'Artists', name:'Vermeer & the Delft Room', note:'A window on the left, a woman absorbed, no hurry at all.',
    tags:['dutch-golden-age','interior'], queries:[
      { src:'met', params:{ q:'Johannes Vermeer', artistOrCulture:'true' }, take:14 },
      { src:'met', params:{ q:'Pieter de Hooch Gerard ter Borch', medium:'Paintings' }, take:22 },
      { src:'aic', q:'vermeer de hooch dutch interior', types:['Painting'], limit:50 },
      { src:'wd', filter:'?item wdt:P170 wd:Q41264 .', limit:24 },
    ]},

  { id:'turner', group:'Artists', name:'J. M. W. Turner', note:'Light dissolving everything it touches, including the ship.',
    tags:['romanticism','british'], queries:[
      { src:'met', params:{ q:'Joseph Mallord William Turner', artistOrCulture:'true' }, take:24 },
      { src:'aic', q:'Turner watercolour english landscape', limit:60 },
      { src:'cma', params:{ artists:'Joseph Mallord William Turner' }, limit:20 },
      { src:'vam', params:{ q:'Turner' }, limit:24 },
      { src:'wd', filter:'?item wdt:P170 wd:Q159758 .', limit:36 },
    ]},

  { id:'sargent', group:'Artists', name:'John Singer Sargent', note:'Society portraits by day; watercolour holidays by afternoon.',
    tags:['american'], queries:[
      { src:'aic', q:'John Singer Sargent', limit:50 },
      { src:'met', params:{ q:'John Singer Sargent', artistOrCulture:'true' }, take:26 },
      { src:'cma', params:{ artists:'John Singer Sargent' }, limit:20 },
    ]},

  { id:'degas', group:'Artists', name:'Edgar Degas', note:'Dancers, laundresses, and the awkward second before a pose.',
    tags:['impressionism','french'], queries:[
      { src:'aic', q:'Edgar Degas', limit:60 },
      { src:'met', params:{ q:'Edgar Degas', artistOrCulture:'true' }, take:26 },
      { src:'cma', params:{ artists:'Edgar Degas' }, limit:20 },
    ]},

  { id:'cassatt', group:'Artists', name:'Mary Cassatt', note:'An American in Paris, and the finest draughtsman of children.',
    tags:['impressionism','american'], queries:[
      { src:'aic', q:'Mary Cassatt', limit:50 },
      { src:'met', params:{ q:'Mary Cassatt', artistOrCulture:'true' }, take:24 },
      { src:'cma', params:{ artists:'Mary Cassatt' }, limit:20 },
    ]},

  { id:'hopper-okeeffe', group:'Artists', name:'Hopper & O’Keeffe', note:'Twentieth-century America: empty diners, enormous flowers.',
    tags:['american'], queries:[
      { src:'aic', q:'Edward Hopper Georgia O’Keeffe', limit:60 },
      { src:'met', params:{ q:'Georgia O’Keeffe', artistOrCulture:'true' }, take:20 },
    ]},

  /* ----------------------------------------------------- Places */
  { id:'venice', group:'Places', name:'Venice', note:'Canaletto’s clean light, Turner’s dissolved one.',
    tags:['venice','italy'], queries:[
      { src:'aic', q:'Venice Venetian canal lagoon', limit:80 },
      { src:'met', params:{ q:'Venice', medium:'Paintings|Drawings|Watercolors' }, take:30 },
      { src:'cma', params:{ q:'venice' }, limit:30 },
      { src:'vam', params:{ q:'Venice' }, limit:30 },
      { src:'wd', filter:'?item wdt:P180 wd:Q641 .', limit:40 },
    ]},

  { id:'paris', group:'Places', name:'Paris', note:'Boulevards in the rain, and everybody at the café.',
    tags:['paris','france'], queries:[
      { src:'aic', q:'Paris boulevard Seine Montmartre', limit:80 },
      { src:'met', params:{ q:'Paris', medium:'Paintings' }, take:30 },
      { src:'cma', params:{ q:'paris', type:'Painting' }, limit:26 },
      { src:'wd', filter:'?item wdt:P180 wd:Q90 .', limit:40 },
    ]},

  { id:'japan', group:'Places', name:'Japan', note:'Rain, snow, pine, and Fuji somewhere at the back.',
    tags:['japan'], queries:[
      { src:'aic', q:'Japan Japanese landscape print', limit:90 },
      { src:'met', params:{ q:'Japan', medium:'Prints|Paintings' }, take:30 },
      { src:'cma', params:{ q:'japan', department:'Japanese Art' }, limit:30 },
    ]},

  { id:'the-sea', group:'Places', name:'The Sea', note:'Marine painting: weather first, boats second.',
    tags:['sea'], queries:[
      { src:'aic', q:'sea coast wave shore marine ship', types:['Painting'], limit:80 },
      { src:'met', params:{ q:'seascape', medium:'Paintings' }, take:28 },
      { src:'cma', params:{ q:'sea coast', type:'Painting' }, limit:30 },
      { src:'smk', params:{ keys:'hav kyst skib' }, limit:26 },
      { src:'wd', filter:'?item wdt:P136 wd:Q158607 .', limit:40 },
    ]},

  { id:'the-north', group:'Places', name:'The North', note:'Nordic light: long shadows, cold water, low sun.',
    tags:['nordic'], queries:[
      { src:'smk', params:{ keys:'landskab' }, limit:40 },
      { src:'smk', params:{ keys:'skagen' }, limit:20 },
      { src:'met', params:{ q:'Scandinavian landscape', medium:'Paintings' }, take:20 },
    ]},

  { id:'new-york', group:'Places', name:'New York', note:'The city painted while it was still being built.',
    tags:['new-york','american'], queries:[
      { src:'aic', q:'New York city street bridge', types:['Painting'], limit:70 },
      { src:'met', params:{ q:'New York', medium:'Paintings' }, take:28 },
    ]},

  /* ---------------------------------------------------- Museums */
  { id:'museum-met', group:'Museums', name:'The Met', note:'Fifth Avenue at 82nd. Two million objects; here are some.',
    tags:['met'], rand:true, queries:[
      { src:'met', params:{ q:'painting', medium:'Paintings' }, take:34 },
    ]},

  { id:'museum-aic', group:'Museums', name:'Art Institute of Chicago', note:'Michigan Avenue, between the two bronze lions.',
    tags:['aic'], rand:true, queries:[
      { src:'aic', q:'painting', types:['Painting','Drawing'], limit:100 },
    ]},

  { id:'museum-cma', group:'Museums', name:'Cleveland Museum of Art', note:'Free to all, since 1916 — and open-licensed since 2019.',
    tags:['cma'], rand:true, queries:[
      { src:'cma', params:{ type:'Painting' }, limit:50 },
    ]},

  { id:'museum-vam', group:'Museums', name:'The V&A', note:'South Kensington: the world’s largest museum of applied art.',
    tags:['vam'], rand:true, queries:[
      { src:'vam', params:{ q:'painting watercolour', year_made_to:'1910' }, limit:50 },
    ]},

  { id:'museum-rijks', group:'Museums', name:'The Rijksmuseum', note:'Amsterdam. Rembrandt, Vermeer, Hals, and the whole Golden Age.',
    tags:['rijks'], rand:true, queries:[
      { src:'wd', filter:'VALUES ?coll { wd:Q190804 } ?item wdt:P195 ?coll .', limit:45 },
    ]},

  { id:'museum-prado', group:'Museums', name:'Museo del Prado', note:'Madrid. Velázquez, Goya, El Greco, Bosch.',
    tags:['prado'], rand:true, queries:[
      { src:'wd', filter:'VALUES ?coll { wd:Q160112 } ?item wdt:P195 ?coll .', limit:45 },
    ]},

  { id:'museum-louvre', group:'Museums', name:'The Louvre', note:'Paris. Rather a lot of it.',
    tags:['louvre'], rand:true, queries:[
      { src:'wd', filter:'VALUES ?coll { wd:Q19675 } ?item wdt:P195 ?coll .', limit:45 },
    ]},

  { id:'museum-ng', group:'Museums', name:'The National Gallery', note:'Trafalgar Square, and free since 1824.',
    tags:['ng'], rand:true, queries:[
      { src:'wd', filter:'VALUES ?coll { wd:Q180788 } ?item wdt:P195 ?coll .', limit:45 },
    ]},

  { id:'museum-harvard', group:'Museums', name:'Harvard Art Museums', note:'Fogg, Busch-Reisinger and Sackler. Needs a free key — see js/keys.js.',
    tags:['harvard'], needs:'harvard', rand:true, queries:[
      { src:'har', params:{ classification:'Paintings' }, limit:45 },
    ]},

  { id:'museum-smk', group:'Museums', name:'SMK, Copenhagen', note:'The Danish national gallery, open-licensed and Nordic to the bone.',
    tags:['smk'], rand:true, queries:[
      { src:'smk', params:{ keys:'maleri' }, limit:50 },
    ]},
];

export const byId = id => PLAYLISTS.find(p => p.id === id) || PLAYLISTS[0];

/** shelves that need a key nobody has supplied stay out of sight */
export const shelves = () => PLAYLISTS.filter(p => !p.needs || has(p.needs));
