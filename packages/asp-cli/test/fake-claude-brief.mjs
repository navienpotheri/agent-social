// A stand-in for an interactive tool: it owns the terminal for a few seconds and then ends by itself (the way a person leaves it).
console.log("interactive tool started");
setTimeout(() => console.log("interactive tool left"), 4000);
