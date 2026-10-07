package main

import (
	"example.com/dep"
	"example.com/gobasics/sub"
)

func Run() {
	sub.Do()
	helper()
	dep.Something()
}

func helper() {}
