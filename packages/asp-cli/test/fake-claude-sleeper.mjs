// A stand-in agent that does nothing for a minute: for testing what Ctrl-C does to a session that is still running.
console.log("sleeper started");
setTimeout(() => console.log("sleeper finished"), 60000);
