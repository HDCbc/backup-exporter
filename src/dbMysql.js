const async = require('async');
const fs = require('fs');
const mysql = require('mysql');
const winston = require('winston');
/**
 * This module handles all interactions with the target database.
 */
module.exports = (() => {
  // The current pool of connections.
  // This will not be instantiated until the init function is called.
  let pool;
  let logger;

  /**
   * Initializes the connection pool for the target database.
   * See https://github.com/brianc/node-postgres
   *
   * @param config - A configuration object to be passed to pg.Pool.
   */
  const init = (config) => {
    logger = winston.loggers.get('app');
    pool = mysql.createConnection(config);
  };

  const query2 = (q, callback) => {
    logger.debug('Postgres Query', { q });
    pool.query(q, (err, res) => {
      if (err) {
        return callback(err);
      }
      return callback(null, res);
    });
  };

  const runScriptFile = (path, callback) => {
    logger.debug('target.runScriptFile', { path });
    async.waterfall([
      async.constant(path), // , 'utf8'),
      fs.readFile,
      // Convert file content to string
      (content, cb) => { cb(null, content.toString()); },
      query2,
    ], callback);
  };

  return {
    init,
    runScriptFile,
  };
})();
