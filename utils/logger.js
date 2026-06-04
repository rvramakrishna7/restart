

const isDev = process.env.NODE_ENV !== "production";

exports.log = (...args) => {
  if (isDev) console.log(...args);
};

exports.error = (...args) => {
  console.error(...args);
};