// Import npm modules
const _ = require('lodash');
const async = require('async');
const chokidar = require('chokidar');
const { exec } = require('child_process');
const mv = require('mv');
const path = require('path');
const winston = require('winston');

// Import local modules
const dbMysql = require('./dbMysql');

let logger;

function runProcess(commandName, command, cwd, cb) {
  // Note, do not log the command here, as it may contain a password.
  logger.info(`Process ${commandName} Started`);
  const start = Date.now();

  // Note that we blank out the env below. This is required, otherwise the current
  // apps configuration (in the .env) will be sent to the child process which will
  // cause conflicts in the configuration (eg in the "target")
  const child = exec(command, { cwd, env: { hello: 'world' } });

  child.stderr.on('data', (data) => {
    logger.warn('Child Process StdErr', { data });
  });

  child.on('close', (code) => {
    const elapsedSec = (Date.now() - start) / 1000;
    if (code !== 0) {
      logger.error(`Process ${commandName} Failure`, { code });
      return cb(`Process ${commandName} Failure`);
    }
    logger.info(`Process ${commandName} Success`, { elapsedSec, code });
    return cb(null);
  });
}

function runScriptFile(db, taskName, scriptPath, callback) {
  logger.info(`Script ${taskName} Started`, { taskName, scriptPath });
  const start = Date.now();

  db.runScriptFile(scriptPath, (err, res) => {
    const elapsedSec = (Date.now() - start) / 1000;
    if (err) {
      logger.error(`Script ${taskName} Failure`, { err });
      return callback(err);
    }
    logger.info(`${taskName} Success`, { elapsedSec });
    return callback(err, res);
  });
}

function processFile(
  db, filepath, workingDir, parallelImports,
  processedExt, user, password, exporterCommand, exporterCwd, callback,
) {
  logger.info('Process File Started', { filepath, workingDir });
  const start = Date.now();

  return async.auto({
    // Drop the MySql database if it currently exists.
    dropDatabasePre: (cb) => {
      runScriptFile(db, 'Drop Database (Pre)', path.join(__dirname, '../sql/dropDatabase.sql'), cb);
    },
    // Create an empty MySql database to restore into.
    createDatabase: ['dropDatabasePre', (res, cb) => {
      runScriptFile(db, 'Create Database', path.join(__dirname, '../sql/createDatabase.sql'), cb);
    }],
    // Restore the backup file into the MySql database.
    restoreDatabase: ['createDatabase', (res, cb) => {
      let cmd;
      if (filepath.endsWith('.xz')) {
        cmd = `xz --decompress --stdout "${filepath}" | grep -v "CHANGE MASTER" | sed 's/PAGE_CHECKSUM=[0|1]//g'| mysql -f -D emr -u ${user} --password=${password}`;
      } else if (filepath.endsWith('.sql')) {
        cmd = `cat "${filepath}" | grep -v "CHANGE MASTER" | sed 's/PAGE_CHECKSUM=[0|1]//g'| mysql -f -D emr -u ${user} --password=${password}`;
      } else {
        cb(`Unhandled filetype for file ${filepath}`);
      }

      runProcess('Restore Database', cmd, '.', cb);
    }],
    // Run the EMR-Exporter against the restored database.
    runExporter: ['restoreDatabase', (res, cb) => {
      runProcess('Export Database', exporterCommand, exporterCwd, cb);
    }],
    // Drop the restored database.
    dropDatabasePost: ['runExporter', (res, cb) => {
      runScriptFile(db, 'Drop Database (Post)', path.join(__dirname, '../sql/dropDatabase.sql'), cb);
    }],
    // Rename the imported file to indicate that it was processed successfully.
    renameFile: ['dropDatabasePost', (res, cb) => {
      const startRename = Date.now();
      const processedPath = path.join(path.dirname(filepath), `${path.basename(filepath)}.${processedExt}`);
      logger.info('Rename File Started', { filepath, processedPath });
      return mv(filepath, processedPath, (err) => {
        const elapsedSec = (Date.now() - startRename) / 1000;
        if (err) {
          logger.error('Rename File Failure', err);
          return cb(err);
        }
        logger.info('Rename File Success', { elapsedSec });
        return cb(null);
      });
    }],
  }, (err) => {
    const elapsedSec = (Date.now() - start) / 1000;
    if (err) {
      logger.error('Process File Failure', err);
      return callback(err);
    }
    logger.info('Process File Success', { elapsedSec });
    return callback(null);
  });
}

function startWatching(watchDir, fileMask, queue) {
  logger.info('Watching Starting', { watchDir, fileMask });

  const fileRegex = new RegExp(fileMask);
  // Full list of options. See below for descriptions. (do not use this example)
  const watcher = chokidar.watch(watchDir, {
    persistent: true,
    ignored: /(^|[/\\])\../,
    ignoreInitial: false,
    alwaysStat: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
  });

  watcher.on('add', (filepath) => {
    logger.info('File Detected', { filepath });

    if (!filepath.match(fileRegex)) {
      logger.info('Skipping', { filepath });
    } else {
      queue.push(filepath);
    }
  });
}

/**
 * Run the importer.
 *
 */
function run(options) {
  logger = winston.loggers.get('app');
  logger.info(_.repeat('=', 160));
  logger.info('Run Started');

  // It is assumed that the options have been verified in the config module.
  const {
    sourceDir,
    processedExt,
    target,
    parallelImports,
    workingDir,
    exporterCommand,
    exporterCwd,
    fileMask,
  } = options;

  const { user, password } = target;

  const db = dbMysql;
  db.init(target);
  // Mask the password before logging.
  const logOptions = Object.assign({}, options, {
    target: Object.assign({}, options.target, { password: 'XXX' }),
  });
  logger.verbose('Configuration');
  _.forEach(_.keys(logOptions), (key) => {
    logger.verbose(`-${key}`, { value: logOptions[key] });
  });

  // Create a queue object with concurrency of 1. When files are added to the queue they will
  // be processed one at a time.
  const queue = async.queue((filepath, cb) => {
    logger.verbose('File Queued', { filepath });
    processFile(db, filepath, workingDir, parallelImports,
      processedExt, user, password, exporterCommand, exporterCwd, cb);
  }, 1);

  // This function keeps the application running as long as it continues to watch for files.
  startWatching(sourceDir, fileMask, queue);
}

// Reveal the public functions
module.exports = {
  run,
};
