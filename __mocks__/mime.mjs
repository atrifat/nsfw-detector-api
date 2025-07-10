// __mocks__/mime.mjs
import { jest } from '@jest/globals';

let mockGetExtension = jest.fn().mockReturnValue('jpg');
let mockGetType = jest.fn().mockReturnValue('image/jpeg');

const mime = {
  getType: mockGetType,
  getExtension: mockGetExtension,
  lookup: mockGetType,
  __setMockGetExtension: (fn) => {
    mockGetExtension = fn;
    mime.getExtension = fn;
  },
  __setMockGetType: (fn) => {
    mockGetType = fn;
    mime.getType = fn;
    mime.lookup = fn;
  },
};

export default mime;