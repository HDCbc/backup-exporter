const winston = require('winston');

const backupExporter = require('./backupExporter');
const config = require('./config');
const configureLogger = require('./configureLogger');

function exit(code) {
  const appLogger = winston.loggers.get('app');
  appLogger.log('info', `Exit Code ${code}`, code);
  appLogger.on('finish', () => process.exit());
  appLogger.end();
}

/**
 * Run the application by loading the configuration and then running the importer.
 *
 * This function is responsible for exitting the process. Return Codes:
 * 0: Successful Export
 * 1: Configuration Failure
 * 2: Exporter Failure
 */
function run() {
  // Load the configuration values.
  config.load((errConfig, configValues) => {
    if (errConfig) {
      // Cannot log to the logger file as the configuration is required to setup the logger.
      console.error('Unable to load configuration', errConfig); //eslint-disable-line
      process.exit(1);
    }

    configureLogger(configValues.logger);

    backupExporter.run(configValues, (errApp) => {
      // If an error occured in the application then exit with an error value.
      if (errApp) {
        exit(2);
      }
      // Otherwise exit successfully.
      exit(0);
    });
  });
}

module.exports = {
  run,
};
