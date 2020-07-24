const dotenv = require('dotenv');
const Joi = require('@hapi/joi');
const nconf = require('nconf');

/**
 * Retrieve the configuration values. Priority of the configuration values is:
 *
 * 1. Overrides specified in function
 * 2. Command line arguments
 * 3. Env variables (including .env file in project root)
 *
 * Note that the .env file will not override system level environmental variables.
 */
function get() {
  // Load any environment variables from .env in the project root directory.
  dotenv.config();

  // The following override have the highest priority.
  nconf.overrides({
    processedExt: 'done',
  });

  // The command line arguments have a high priority.
  nconf.argv();

  // The environmental variables have a medium priority.
  nconf.env({ separator: '_' });

  // The following defaults have the lowest priority.
  nconf.defaults({
    connectionAttempts: 10,
    connectionInterval: 1000,
    logger: {
      level: 'info',
      filename: './logs/backup-exporter.log',
      maxsize: 1048576, // 1 MB
      maxFiles: 10,
      zippedArchive: true,
      tailable: true,
      timezone: 'America/Vancouver',
    },
    // sourceDir: '/hdc/crypt/uploads',
    parallelImports: 10,
    target: {
      ssl: {},
    },
  });

  // Create the configuration object.
  // Note that we convert the underscore format to a more javascript friendly camel case format.
  const config = {
    sourceDir: nconf.get('sourceDir'),
    connectionAttempts: nconf.get('connectionAttempts'),
    connectionInterval: nconf.get('connectionInterval'),
    target: nconf.get('target'),
    processedExt: nconf.get('processedExt'),
    logger: nconf.get('logger'),
    parallelImports: nconf.get('parallelImports'),
    exporterCommand: nconf.get('exporterCommand'),
    exporterCwd: nconf.get('exporterCwd'),
    fileMask: nconf.get('fileMask'),
    // workingDir: nconf.get('workingDir'),
  };

  return config;
}

/**
 * Validate the configuration values.
 *
 * Note that extra variables will cause an error. This is possible with the nested properties
 * such as database.malicious.
 *
 * @param config - The configuration values to validate.
 * @param callback - The callback to call when the function is complete.
 * @param callback.err - If error, the error will be populated here. Note that we only populate
 * the message to prevent sensitive data from being logged.
 * @param callback.res - If success, the validate (and possibly transformed) configuration values.
 */
function validate(config, callback) {
  const schema = Joi.object().keys({
    sourceDir: Joi.string(),
    // workingDir: Joi.string(),
    processedExt: Joi.string(),
    parallelImports: Joi.number().integer().min(1),
    connectionAttempts: Joi.number().integer().min(1),
    connectionInterval: Joi.number().integer().min(1),
    exporterCommand: Joi.string(),
    exporterCwd: Joi.string(),
    fileMask: Joi.string(),
    target: Joi.object().keys({
      dialect: Joi.string(),
      host: Joi.string(),
      port: Joi.number().integer().min(1),
      database: Joi.string(),
      user: Joi.string(),
      password: Joi.string(),
    }),
    logger: Joi.object().keys({
      level: Joi.string().regex(/^(error|warn|info|verbose|debug|silly)$/),
      filename: Joi.string(),
      maxsize: Joi.number().integer().min(1),
      maxFiles: Joi.number().integer().min(1),
      zippedArchive: Joi.boolean(),
      tailable: Joi.boolean(),
      timezone: Joi.string(),
    }),
  });

  const validateOptions = {
    presence: 'required', // All fields required by default
  };
  // Return result.
  const result = Joi.validate(config, schema, validateOptions, callback);

  return result;
}

/**
 * This function is used to load configuration values from various sources into an object.
 * See get function for details on the precedence of configuration values.
 * @param callback - The callback to call when this function is complete.
 * @param callback.err - If failed, the error.
 * @param callback.res - If success, the configuration object.
 */
function load(callback) {
  const cfg = get();

  validate(cfg, (err, res) => {
    if (err) {
      // Note that we do not callback the entire error here which would include the object
      // being parsed. This is not great because later the object could be logged and included
      // the cleartext password/passphrases.
      return callback(err.message);
    }
    return callback(null, res);
  });
}

module.exports = {
  load,
};
