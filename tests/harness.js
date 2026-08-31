/* Tiny assertion harness shared by the test pages. Prints a single RESULT
 * line so the whole run can be read back as page text. */
(function (global) {
  'use strict';

  function create(listId, summaryId) {
    var results = document.getElementById(listId);
    var passed = 0, failed = 0;

    function check(name, condition, detail) {
      var li = document.createElement('li');
      if (condition) {
        passed++;
        li.className = 'pass';
        li.textContent = 'PASS  ' + name;
      } else {
        failed++;
        li.className = 'fail';
        li.textContent = 'FAIL  ' + name + (detail ? '  →  ' + detail : '');
      }
      results.appendChild(li);
    }

    function eq(name, actual, expected) {
      check(name, actual === expected, 'got ' + JSON.stringify(actual) +
            ', expected ' + JSON.stringify(expected));
    }

    function has(haystack, needle, name) {
      check(name || ('contains ' + needle), String(haystack).indexOf(needle) >= 0,
            'not found in output');
    }

    function finish() {
      var summary = document.getElementById(summaryId);
      summary.textContent = 'RESULT: ' + passed + ' passed, ' + failed + ' failed';
      summary.style.color = failed ? '#cf222e' : '#1a7f37';
      document.title = failed ? 'FAIL (' + failed + ')' : 'PASS (' + passed + ')';
    }

    return { check: check, eq: eq, has: has, finish: finish,
             counts: function () { return { passed: passed, failed: failed }; } };
  }

  global.Harness = { create: create };
})(window);
