// __mocks__/mime.mjs
import { jest } from '@jest/globals';

const getType = jest.fn().mockReturnValue('image/jpeg');
const getExtension = jest.fn().mockReturnValue('jpg');
const lookup = getType;

export const mime = {
  getType,
  getExtension,
  lookup,
};

export default mime;