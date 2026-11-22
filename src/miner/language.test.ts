import { describe, it, expect } from 'vitest';
import { detectLanguage } from './language.js';

describe('detectLanguage', () => {
  // REQ-8 table — one test per row
  it('.ts → typescript', () => expect(detectLanguage('src/foo.ts')).toBe('typescript'));
  it('.tsx → typescript', () => expect(detectLanguage('src/App.tsx')).toBe('typescript'));
  it('.js → javascript', () => expect(detectLanguage('index.js')).toBe('javascript'));
  it('.mjs → javascript', () => expect(detectLanguage('lib/mod.mjs')).toBe('javascript'));
  it('.cjs → javascript', () => expect(detectLanguage('lib/mod.cjs')).toBe('javascript'));
  it('.py → python', () => expect(detectLanguage('script.py')).toBe('python'));
  it('.rb → ruby', () => expect(detectLanguage('app.rb')).toBe('ruby'));
  it('.go → go', () => expect(detectLanguage('main.go')).toBe('go'));
  it('.rs → rust', () => expect(detectLanguage('src/lib.rs')).toBe('rust'));
  it('.java → java', () => expect(detectLanguage('Main.java')).toBe('java'));
  it('.kt → kotlin', () => expect(detectLanguage('App.kt')).toBe('kotlin'));
  it('.cs → csharp', () => expect(detectLanguage('Program.cs')).toBe('csharp'));
  it('.cpp → cpp', () => expect(detectLanguage('src/engine.cpp')).toBe('cpp'));
  it('.cc → cpp', () => expect(detectLanguage('src/engine.cc')).toBe('cpp'));
  it('.cxx → cpp', () => expect(detectLanguage('src/engine.cxx')).toBe('cpp'));
  it('.c → c', () => expect(detectLanguage('util.c')).toBe('c'));
  it('.h → c', () => expect(detectLanguage('util.h')).toBe('c'));
  it('.swift → swift', () => expect(detectLanguage('App.swift')).toBe('swift'));
  it('.php → php', () => expect(detectLanguage('index.php')).toBe('php'));
  it('.sh → shell', () => expect(detectLanguage('deploy.sh')).toBe('shell'));
  it('.bash → shell', () => expect(detectLanguage('setup.bash')).toBe('shell'));
  it('.md → markdown', () => expect(detectLanguage('README.md')).toBe('markdown'));

  it('unknown extension → unknown', () => {
    expect(detectLanguage('file.xyz')).toBe('unknown');
    expect(detectLanguage('Makefile')).toBe('unknown');
    expect(detectLanguage('no-extension')).toBe('unknown');
  });

  it('path with multiple dots uses last extension (foo.test.ts → typescript)', () => {
    expect(detectLanguage('src/foo.test.ts')).toBe('typescript');
    expect(detectLanguage('lib/util.spec.js')).toBe('javascript');
  });

  it('Windows-style backslash paths work', () => {
    expect(detectLanguage('src\\module\\index.ts')).toBe('typescript');
  });
});
