export function validateInputs({ homeAddress, apiKey, file }) {
  const errors = [];
  if (!homeAddress?.trim()) errors.push('Home address is required.');
  if (!apiKey?.trim()) errors.push('openrouteservice API key is required.');
  if (!file) errors.push('Please upload a CSV/XLSX file.');
  return errors;
}
