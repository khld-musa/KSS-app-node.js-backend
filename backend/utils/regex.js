// Escapes user input so it can be used as a literal inside a RegExp / $regex.
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { escapeRegex };
