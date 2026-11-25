/* Slides page: the viewer with only the Pathology panel on it, for showing the slide photos to someone with a plain link.
   Served by serve_viewer.py at /pathology-slides, which gives the page its own view settings (only the Pathology panel
   ticked) and loads this file after the viewer's own script.

   Nothing can be changed here and nothing is added: it is the family viewer's Pathology panel, alone on the page. The
   rest of the viewer is hidden, not removed, and stays reachable at the viewer's own address. For a page where a
   reviewer can change things, see review_view.js. No patient data in this file. */
(() => {
  const PATH = window.PATH;
  if (!PATH || !PATH.el) return;
  const css = document.createElement('style');
  /* the same parts of the viewer that the review page hides; the last rule hides three buttons that act on charts and
     panels this page does not show (a line on the timeline, the Procedures timeline, a photo as a keyframe) */
  css.textContent = `
body.slidesOnly aside,body.slidesOnly .navpin,body.slidesOnly #kfCard,body.slidesOnly #txCard,body.slidesOnly #single,body.slidesOnly #mrd,body.slidesOnly #askTop,body.slidesOnly #askSide,body.slidesOnly .askPanelBtn{display:none!important}
body.slidesOnly .wrap{grid-template-columns:minmax(0,1fr)!important}
body.slidesOnly :is(.card,.cmp):not(.slidesTarget):not(:has(.slidesTarget)){display:none!important}
body.slidesOnly .slidesTarget>.cmph .ctl,body.slidesOnly #compare~.sub{display:none!important}
body.slidesOnly .pth-lb .top .t{flex-basis:100%}
body.slidesOnly .pth-b:is([title^="A line on every chart"],[title*="Procedures timeline"],[title*="timeline charts"]){display:none!important}
@media (max-width:760px){body.slidesOnly .pth-main{flex-direction:column}body.slidesOnly .pth-img{min-height:0}}`;
  document.head.append(css);
  document.body.classList.add('slidesOnly');
  document.title = 'Pathology slides';
  const mark = () => { const p = PATH.el(); if (p) p.classList.add('slidesTarget'); return p; };
  window.PATH_EXT = {drawn: mark};   // the panel is drawn again after every click: keep it marked as the one to show
  if (!mark()) { const w = PATH.where(); if (w.caseKey) PATH.open(w.caseKey); mark(); }
  window.dispatchEvent(new Event('resize'));   // the panel now has the page's full width
})();
