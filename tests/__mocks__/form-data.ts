export default class FormData {
  private data: Map<string, any> = new Map();

  append(name: string, value: any, filename?: string) {
    this.data.set(name, value);
  }

  getHeaders() {
    return {
      'content-type': 'multipart/form-data; boundary=mock-boundary'
    };
  }

  // Mock method to get the appended data for testing
  get(name: string) {
    return this.data.get(name);
  }
}