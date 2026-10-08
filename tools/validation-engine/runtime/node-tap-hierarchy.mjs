import { createHash } from 'node:crypto';
import { inspect } from 'node:util';

const tapEscape = (input) =>
  String(input)
    .replaceAll('\\', '\\\\')
    .replaceAll('\b', '\\b')
    .replaceAll('\f', '\\f')
    .replaceAll('\t', '\\t')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\v', '\\v')
    .replaceAll('#', '\\#');
const inspected = (input) =>
  inspect(input, { colors: false, breakLength: Infinity });
// Actual Node TAP13 hierarchy reader. Pure metadata mapping, never execution.
export function readNodeTapHierarchy(
  reportBytes,
  file,
  { sourceEntries = [] } = {}
) {
  if (
    !Buffer.isBuffer(reportBytes) ||
    typeof file !== 'string' ||
    !file ||
    !Array.isArray(sourceEntries) ||
    sourceEntries.some(
      (source) =>
        !source ||
        typeof source.name !== 'string' ||
        !source.name ||
        typeof source.absoluteFile !== 'string' ||
        !source.absoluteFile
    ) ||
    new Set(sourceEntries.map((source) => source.name)).size !==
      sourceEntries.length ||
    new Set(sourceEntries.map((source) => source.absoluteFile)).size !==
      sourceEntries.length
  )
    throw Error('Actual native report bytes/file required');
  const lines = reportBytes.toString('utf8').split(/\r?\n/),
    issues = [],
    nodes = [],
    cases = [],
    summaries = {},
    sourceEntryByReporterName = new Map(
      sourceEntries.map((source, index) => {
        const reporterName = tapEscape(source.name);
        return [
          reporterName,
          {
            reporterName,
            ordinal: index + 1,
            location: inspected(`${source.absoluteFile}:1:1`),
          },
        ];
      })
    ),
    consumedSourceFailures = new Set();
  if (sourceEntryByReporterName.size !== sourceEntries.length)
    throw Error('Actual native report bytes/file required');
  let cursor = 0;
  const issue = (message) => issues.push(message);
  const indent = (n) => ' '.repeat(n);
  const subtestAt = (n) => new RegExp('^' + indent(n) + '# Subtest: (.*)$');
  const resultAt = (n) =>
    new RegExp('^' + indent(n) + '(ok|not ok) (\\d+) - (.*)$');
  function level(n, parentNames = [], parentOrdinals = []) {
    const children = [];
    let declared = null;
    while (cursor < lines.length) {
      const line = lines[cursor];
      const start = subtestAt(n).exec(line);
      if (start) {
        const name = start[1],
          startLine = cursor + 1;
        cursor++;
        const ordinal = children.length + 1,
          suiteNames = [...parentNames, name],
          ordinalPath = [...parentOrdinals, ordinal];
        let nested = [];
        while (
          cursor < lines.length &&
          !subtestAt(n + 4).test(lines[cursor]) &&
          !resultAt(n).test(lines[cursor]) &&
          !/^\s*(?:# Subtest:|(?:not )?ok \d|1\.\.|Bail out!)/.test(
            lines[cursor]
          )
        )
          cursor++;
        if (subtestAt(n + 4).test(lines[cursor] ?? ''))
          nested = level(n + 4, suiteNames, ordinalPath);
        // Node runner output/comments between the registration and completion are
        // retained in original report; never interpreted as a test completion.
        while (
          cursor < lines.length &&
          !resultAt(n).test(lines[cursor]) &&
          !subtestAt(n).test(lines[cursor]) &&
          !new RegExp('^' + indent(n) + '1\\.\\.').test(lines[cursor])
        ) {
          if (/^\s*(?:Bail out!|not ok\b|ok\b|# Subtest:)/.test(lines[cursor]))
            issue('Unexpected nested result/registration');
          cursor++;
        }
        const completion = resultAt(n).exec(lines[cursor] ?? '');
        if (!completion) {
          issue('Missing exact completion for ' + JSON.stringify(suiteNames));
          break;
        }
        const rawCompletion = lines[cursor++],
          directive = /^(.*?) # (SKIP|TODO)(?: (.*))?$/i.exec(completion[3]);
        const resultName = directive ? directive[1] : completion[3],
          reportedOrdinal = Number(completion[2]);
        const diagnostic = [];
        if (lines[cursor] === indent(n + 2) + '---') {
          do {
            diagnostic.push(lines[cursor++]);
          } while (
            cursor < lines.length &&
            lines[cursor] !== indent(n + 2) + '...'
          );
          if (cursor >= lines.length) issue('Unterminated Node diagnostic');
          else diagnostic.push(lines[cursor++]);
        }
        const rawDiagnostic = diagnostic.join('\n'),
          type = new RegExp(
            '^' + indent(n + 2) + "type: '(test|suite)'$",
            'm'
          ).exec(rawDiagnostic)?.[1];
        if (!type) issue('Actual Node test/suite type missing');
        const status = directive
          ? directive[2].toLowerCase()
          : completion[1] === 'ok'
            ? 'passed'
            : 'failed';
        // When a test module cannot load, Node reports the failed source file as
        // a top-level test using its runner-specific source ordinal, not the next
        // top-level case ordinal. Admit only the exact reporter name, ordinal,
        // and absolute location derived from the frozen command root. Every
        // ordinary case still requires strict sequential ordinal/name closure.
        const sourceLocation = /^\s+location: (.+)$/m.exec(rawDiagnostic)?.[1],
          sourceEntry = sourceEntryByReporterName.get(name),
          sourceFailureSignature =
            n === 0 &&
            status === 'failed' &&
            type === 'test' &&
            resultName === name &&
            /^\s+failureType: 'testCodeFailure'$/m.test(rawDiagnostic) &&
            (/^\s+exitCode: (?:-[1-9]\d*|[1-9]\d*)$/m.test(rawDiagnostic) ||
              /^\s+signal: (?!~$|null$).+$/m.test(rawDiagnostic)) &&
            /^\s+error: 'test failed'$/m.test(rawDiagnostic) &&
            /^\s+code: 'ERR_TEST_FAILURE'$/m.test(rawDiagnostic),
          registeredSourceFailure =
            sourceFailureSignature &&
            sourceEntry?.ordinal === reportedOrdinal &&
            sourceLocation === sourceEntry?.location &&
            !consumedSourceFailures.has(name),
          sourceNamedTopLevel =
            n === 0 && type === 'test' && resultName === name && sourceEntry;
        if (registeredSourceFailure) consumedSourceFailures.add(name);
        if (sourceNamedTopLevel && status !== 'failed')
          issue('Native source wrapper has no discovered cases');
        else if (
          (sourceFailureSignature || sourceNamedTopLevel) &&
          !registeredSourceFailure
        )
          issue('Node case ordinal/name mismatch');
        else if (
          (reportedOrdinal !== ordinal || resultName !== name) &&
          !registeredSourceFailure
        )
          issue('Node case ordinal/name mismatch');
        if (directive && completion[1] === 'not ok')
          issue('Contradictory native directive/failure');
        const node = {
          file,
          name,
          ordinal,
          type,
          status,
          suitePath: parentNames,
          ordinalPath,
          startLine,
          line: cursor - diagnostic.length,
          rawCompletion,
          rawDiagnostic,
          skipReason: directive?.[3] ?? null,
          children: nested,
        };
        children.push(node);
        nodes.push(node);
        if (type === 'test') {
          if (nested.length)
            issue(
              'Parent test with children requires explicit reporter count semantics'
            );
          const fullName = parentNames.length ? suiteNames.join(' > ') : name;
          cases.push({
            ...node,
            name: fullName,
            leafName: name,
            caseId: JSON.stringify([file, ordinalPath, suiteNames]),
          });
        } else if (type === 'suite' && !nested.length)
          issue('Suite without discoverable child cases');
        continue;
      }
      const plan = new RegExp('^' + indent(n) + '1\\.\\.(\\d+)$').exec(line);
      if (plan) {
        if (declared !== null) issue('Duplicate level plan');
        declared = Number(plan[1]);
        cursor++;
        break;
      }
      // Node emits captured console output as unindented TAP comments even while
      // a suite is open. These are not a return to the parent's result level.
      if (
        n > 0 &&
        !line.startsWith(indent(n)) &&
        line.trim() &&
        !/^#(?! Subtest:)/.test(line)
      )
        break;
      if (/^\s*Bail out!/.test(line)) issue('Node TAP bailout');
      cursor++;
    }
    if (declared === null || declared !== children.length)
      issue(
        'Hierarchy plan/discovery mismatch at ' + JSON.stringify(parentNames)
      );
    return children;
  }
  if (lines[cursor++] !== 'TAP version 13') issue('Missing Node TAP13 header');
  const roots = level(0);
  for (; cursor < lines.length; cursor++) {
    const line = lines[cursor],
      summary =
        /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (summary) {
      if (summary[1] in summaries) issue('Duplicate native summary');
      summaries[summary[1]] = Number(summary[2]);
    } else if (/^\s*(?:# Subtest:|(?:not )?ok \d|1\.\.|Bail out!)/.test(line))
      issue('Unexpected trailing TAP structure');
  }
  const counts = {
    passed: cases.filter((c) => c.status === 'passed').length,
    failed: cases.filter((c) => c.status === 'failed').length,
    skipped: cases.filter((c) => c.status === 'skip').length,
  };
  if (
    Object.keys(summaries).length !== 7 ||
    !cases.length ||
    summaries.tests !== cases.length ||
    summaries.suites !== nodes.filter((n) => n.type === 'suite').length ||
    summaries.pass !== counts.passed ||
    summaries.fail !== counts.failed ||
    summaries.skipped !== counts.skipped ||
    Object.values(counts).reduce((a, b) => a + b, 0) !== cases.length
  )
    issue('Actual hierarchy leaf/summary counts disagree');
  if (summaries.cancelled !== 0 || summaries.todo !== 0)
    issue('Cancelled/TODO native cases not accepted');
  for (const node of nodes) {
    if (
      node.status === 'failed' &&
      !/^\s+(?:error|failureType):/m.test(node.rawDiagnostic)
    )
      issue('Native failure diagnostic absent');
    if (
      node.type === 'suite' &&
      node.status === 'failed' &&
      !node.children.some((child) => child.status === 'failed')
    )
      issue(
        'Suite/hook failure without a matching child failure requires infrastructure review'
      );
    if (
      node.type === 'suite' &&
      node.status === 'passed' &&
      node.children.some((child) => child.status === 'failed')
    )
      issue('Contradictory suite/child result');
  }
  return {
    reportSha256: createHash('sha256').update(reportBytes).digest('hex'),
    cases,
    counts,
    summaries,
    nodes,
    roots,
    issues: [...new Set(issues)],
    complete: issues.length === 0,
    rawBytes: reportBytes.length,
    format: 'node-tap13-hierarchy-v1',
  };
}
