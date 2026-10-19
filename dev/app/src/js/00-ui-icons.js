/* Shared decorative icons: labels remain on their surrounding controls. */
/** Return decorative outline SVG markup for a known name, falling back to the book icon. */
function uiIcon(name) {
  const paths = {
    menu: "M4 6h16M4 12h16M4 18h16",
    search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    home: "M3 10l9-7 9 7v11h-6v-7H9v7H3z",
    book: "M12 5v16M12 5C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 1z",
    exam: "M3 9h18M4 9v11m5-11v11m6-11v11m5-11v11M2 21h20M2 7l10-5 10 5z",
    timer: "M9 2h6M12 6v2m0 4v4l3 2M21 14a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    review: "M3 10a9 9 0 1 1 1 8M3 4v6h6",
    edit: "M12 20H4V4h10M10 14l1-4 8-8 3 3-8 8z",
    file: "M5 2h10l4 4v16H5zM14 2v5h5M8 11h8M8 15h8M8 19h5",
    plus: "M12 4v16M4 12h16",
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${paths[name] || paths.book}"/></svg>`;
}
