/* eslint no-console: 0 */

const fs = require('fs');
const path = require('path');

// Chai
const chai = require('chai');
chai.use(require('chai-as-promised'));
chai.use(require('chai-datetime'));

global.assert = chai.assert;

// Sinon
global.sinon = require('sinon');

// Console
console.json = (object, pretty) => {
  pretty = pretty || false;

  let json;
  if (pretty) {
    json = JSON.stringify(object, null, 2);
  } else {
    json = JSON.stringify(object);
  }

  console.log.call(console, json);
};

// Test object
global.test = {
  getFixture(filename) {
    return fs.readFileSync(path.join(__dirname, './fixtures/', filename), 'utf8').trim();
  },

  getFixtureJSON(filename) {
    let json = {};
    try {
      json = JSON.parse(this.getFixture(`${filename.json}`));
    } catch (err) {
      console.error(err);
    }
    return json;
  },
};
