require('babel-core/register')(require('../package.json').babel);

// Force NODE_ENV to be `test`
// process.env.NODE_ENV = 'test';

// Start tests
require('../test/common');
