export const removeTrailingZeros = (str: string): string => {
  return str.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0*$/, '');
};
