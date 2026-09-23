document.addEventListener('submit', function (e) {
  if (e.target.hasAttribute('data-confirm') && !confirm('مطمئن هستید؟')) {
    e.preventDefault();
  }
});
