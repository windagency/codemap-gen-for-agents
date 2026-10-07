package gob

import "example.com/svc/goa"

func UseA() int {
	return goa.HelperA() + 1
}
