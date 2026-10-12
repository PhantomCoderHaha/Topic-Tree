const show = () => (document.getElementById("w").textContent = innerWidth);
show();
addEventListener("resize", show);
