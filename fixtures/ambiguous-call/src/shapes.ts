export interface Shape {
  area(): number;
}

export class Circle implements Shape {
  area(): number {
    return 1;
  }
}

export class Square implements Shape {
  area(): number {
    return 2;
  }
}

export class Triangle implements Shape {
  area(): number {
    return 3;
  }
}
