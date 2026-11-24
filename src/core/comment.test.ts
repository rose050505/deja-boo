import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isCommentLine } from './comment.js';

describe('isCommentLine', () => {
  it.each(['', '   ', ' * Return request header.', ' *', ' */', '/**', '/* x', '// x', '    # note', '#', '#!/usr/bin/env python', '## Heading'])('%j is comment-like', l => {
    expect(isCommentLine(l)).toBe(true);
  });
  it.each(['#include <stdio.h>', '#define X 1', '#[derive(Debug)]', '#main { color: red }', '*p = 1;', '*p++ = *q++;', 'return x;', '@api public', 'x = 1  # trailing', '{', '}'])('%j is code', l => {
    expect(isCommentLine(l)).toBe(false);
  });
  it('property: a blank line is always comment-like; a line starting with a letter or digit never is', () => {
    fc.assert(fc.property(fc.stringMatching(/^[ \t]*$/), s => isCommentLine(s)));
    fc.assert(fc.property(fc.stringMatching(/^[ \t]*[A-Za-z0-9_(\[{][^\n]*$/), s => !isCommentLine(s)));
  });
});
