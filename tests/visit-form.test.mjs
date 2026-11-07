import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'esbuild';

// Execute the real form callbacks with a small hook renderer. Network and
// child widgets are replaced; form state and save handlers are real.
const result = await build({ entryPoints: ['src/components/Patients/EMRForm.tsx'], bundle: true,
  write: false, platform: 'node', format: 'esm', plugins: [{ name: 'form-dependencies', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'form-mock' }));
    builder.onResolve({ filter: /services\/|lib\/supabase$|\.\/PhysicalExaminationSection$|\.\/VoiceRecorder$|Auth\/useAuth$/ }, args => ({ path: args.path, namespace: 'form-mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'form-mock' }, ({ path }) => {
      let contents;
      if (path === 'react') contents = 'export default globalThis.formReact; export const {useState,useEffect,useRef,forwardRef,createElement}=globalThis.formReact;';
      else if (path.endsWith('visitService')) contents = 'export const visitService = { addVisit: (...args) => globalThis.formSave(...args), updateVisit: (...args) => globalThis.formSave(...args) };';
      else if (path.endsWith('profileService')) contents = 'export const getCurrentProfile = async () => ({clinicId:"clinic"});';
      else if (path.endsWith('useAuth')) contents = 'export const useAuth = () => ({user:{id:"user",clinicId:"clinic"}});';
      else if (path.endsWith('masterDataService')) contents = 'export const masterDataService = {};';
      else if (path.endsWith('authService')) contents = 'export const authService = {};';
      else if (path.endsWith('presetService')) contents = 'export const presetService = {};';
      else if (path.endsWith('ocrService')) contents = 'export const analyzeVisitImageWithAI = () => {};';
      else if (path.endsWith('supabase')) contents = 'export const supabase = null;';
      else contents = 'export default () => null;';
      return { contents };
    });
  } }] });

let slots = [], cursor = 0;
globalThis.formReact = { ...React,
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  },
  useRef(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useEffect() {},
};
globalThis.alert = () => {};
const { default: EMRForm } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  return typeof tree === 'string' ? tree : tree?.props ? text(tree.props.children) : '';
}
function setup(existingVisit) {
  slots = [];
  let saved = 0;
  const props = { patient: { id: 'patient', name: 'Example', gender: 'female' }, initialVisitDate: '2026-11-07',
    initialVisitTime: '10:00', ocrData: {}, existingVisit, onSave: () => { saved++; } };
  const render = () => { cursor = 0; return EMRForm(props); };
  const saveButton = tree => nodes(tree).find(node => node.type === 'button' && /^(Save Visit|Update Visit|Saving|Updating)/.test(text(node)));
  const testInput = tree => nodes(tree).find(node => node.type === 'input' && node.props.placeholder === 'Type to search or enter custom');
  return { render, saveButton, testInput, get saved() { return saved; } };
}

test('manual test typing is captured; blank rows block saving; failed saves keep entries and retry identity', async t => {
  t.mock.method(console, 'error', () => {});
  const form = setup();
  let tree = form.render();
  const add = nodes(tree).find(node => node.type === 'button' && node.props.onClick?.name === 'addTestOrdered');
  assert.ok(add); add.props.onClick();
  tree = form.render();
  let calls = [];
  globalThis.formSave = async (...args) => { calls.push(args); throw new Error('Connection lost'); };
  await form.saveButton(tree).props.onClick();
  assert.equal(calls.length, 0);
  tree = form.render();
  assert.match(text(nodes(tree).find(node => node.props?.role === 'alert')), /Enter a name for test 1/);
  form.testInput(tree).props.onChange({ target: { value: 'Custom blood test' } });
  tree = form.render();
  await form.saveButton(tree).props.onClick();
  tree = form.render();
  assert.equal(form.saved, 0);
  assert.equal(form.testInput(tree).props.value, 'Custom blood test');
  assert.match(text(nodes(tree).find(node => node.props?.role === 'alert')), /Connection lost/);
  const [visit, options] = calls[0];
  assert.equal(visit.testsOrdered[0].testName, 'Custom blood test');
  assert.ok(visit.testsOrdered[0].id);
  await form.saveButton(tree).props.onClick();
  assert.equal(calls[1][1].requestId, options.requestId);
  assert.equal(calls[1][1].newVisitId, options.newVisitId);
  // Changing an ambiguous save keeps the same target visit to avoid duplicates.
  tree = form.render(); form.testInput(tree).props.onChange({ target: { value: 'Renamed test' } });
  tree = form.render();
  globalThis.formSave = async (...args) => { calls.push(args); return { id: options.newVisitId }; };
  await form.saveButton(tree).props.onClick();
  assert.notEqual(calls[2][1].requestId, options.requestId);
  assert.equal(calls[2][1].newVisitId, options.newVisitId);
  assert.equal(form.saved, 1);
});

test('editing retains test IDs, master links and the exact concurrency token', async () => {
  const existing = { id: 'visit', doctorId: 'doctor', date: new Date('2026-11-07T10:00:00Z'),
    saveVersion: '2026-11-07T10:00:00.123456Z', vitals: {}, prescriptions: [], testsOrdered: [{
      id: 'test', testId: 'master', testName: 'CBC', testType: 'lab', urgency: 'routine', status: 'completed', orderedDate: new Date(),
    }] };
  const form = setup(existing);
  let tree = form.render();
  assert.equal(form.testInput(tree).props.value, 'CBC');
  let release, args;
  globalThis.formSave = (...input) => { args = input; return new Promise(resolve => { release = resolve; }); };
  const pending = form.saveButton(tree).props.onClick();
  await Promise.resolve(); await Promise.resolve();
  tree = form.render();
  assert.equal(tree.type, 'fieldset');
  assert.equal(tree.props.disabled, true);
  await form.saveButton(tree).props.onClick(); // Guard against a duplicate click.
  assert.equal(args[0], 'visit');
  assert.equal(args[1].testsOrdered[0].id, 'test');
  assert.equal(args[1].testsOrdered[0].testId, 'master');
  assert.equal(args[1].testsOrdered[0].status, 'completed');
  assert.equal(args[2].expectedUpdatedAt, existing.saveVersion);
  release({ id: 'visit' }); await pending;
  assert.equal(form.saved, 1);
});
