ngapp.service('writeObjectToElementService', function() {
    const vtUnknown = xelib.valueTypes.indexOf('vtUnknown');
    const vtNumber = xelib.valueTypes.indexOf('vtNumber');
    const vtReference = xelib.valueTypes.indexOf('vtReference');
    const vtFlags = xelib.valueTypes.indexOf('vtFlags');
    const vtEnum = xelib.valueTypes.indexOf('vtEnum');
    const vtArray = xelib.valueTypes.indexOf('vtArray');
    const vtStruct = xelib.valueTypes.indexOf('vtStruct');

    const stInteger = xelib.smashTypes.indexOf('stInteger');
    const stFloat = xelib.smashTypes.indexOf('stFloat');
    const stUnsortedArray = xelib.smashTypes.indexOf('stUnsortedArray');
    const stUnsortedStructArray = xelib.smashTypes.indexOf('stUnsortedStructArray');
    const stSortedArray = xelib.smashTypes.indexOf('stSortedArray');
    const stSortedStructArray = xelib.smashTypes.indexOf('stSortedStructArray');
    
    // reference is of format {plugin name}:{form id without load order}
    let getFormIdFromReference = function(reference) {
        if (reference === 0) {
            return '00000000';
        }

        const [filename, formIdStem] = reference.split(':');
        const loadOrder = xelib.WithHandle(
            xelib.FileByName(filename),
            fileId => xelib.GetFileLoadOrder(fileId)
        );
        const loadOrderString = xelib.Hex(loadOrder, 2);
        return loadOrderString + formIdStem;
    }

    let getRecordValue = function(id, valueType) {
        switch (valueType) {
            case vtNumber:
                const smashType = xelib.SmashType(id);
                if (smashType === stInteger) {
                    return xelib.GetIntValue(id, '');
                }
                else if (smashType === stFloat) {
                    return xelib.GetFloatValue(id, '');
                }
                else {
                    return 0;
                }
            case vtReference:
                return xelib.Hex(xelib.GetUIntValue(id, ''), 8);
            case vtFlags:
                // GetEnabledFlags returns [""] if no enabled flags, we want []
                return xelib.GetEnabledFlags(id, '').filter(flag => flag.length > 0);
            default:
                return xelib.GetValue(id, '');
        }
    }

    let writeValueToRecord = function(id, value, valueType) {
        switch (valueType) {
            case vtNumber:
                const smashType = xelib.SmashType(id);
                if (smashType === stInteger) {
                    xelib.SetIntValue(id, '', value);
                }
                else if (smashType === stFloat) {
                    xelib.SetFloatValue(id, '', value);
                }
                break;
            case vtFlags:
                xelib.SetEnabledFlags(id, '', value);
                break;
            default:
                xelib.SetValue(id, '', value);
                break;
        }
    }

    let getWriteValue = function(id, value, valueType) {
        switch (valueType) {
            case vtReference:
                return getFormIdFromReference(value);
            case vtFlags:
                // e.g. value = {"Flag 1": true, "Flag 2": false}, return = ["Flag 1"]
                return Object.entries(value).reduce((enabledFlags, [flagName, flagEnabled]) => {
                    if (flagEnabled) {
                        enabledFlags.push(flagName);
                    }
                    return enabledFlags;
                }, []);
            case vtEnum:
                return xelib.GetEnumOptions(id, '')[value];
            default:
                return value;
        }
    }

    let areValuesEqual = function(recordValue, writeValue, valueType) {
        if (valueType === vtNumber) {
            const tolerance = 0.0001;
            return Math.abs(recordValue - writeValue) < tolerance;
        }
        else if (valueType === vtFlags) {
            return recordValue.length === writeValue.length && recordValue.every(recordFlag => writeValue.includes(recordFlag));
        }
        else {
            return recordValue === writeValue;
        }
    }

    let writeValueToElement = function(id, value, valueType) {
        const recordValue = getRecordValue(id, valueType);
        const writeValue = getWriteValue(id, value, valueType);

        if (writeValue === undefined) {
            console.log(xelib.Path(id) + ': skipped' + recordValue);
        }

        if (!areValuesEqual(recordValue, writeValue, valueType)) {
            console.log(xelib.Path(id) + ': ' + recordValue + ' -> ' + writeValue);
            writeValueToRecord(id, writeValue, valueType);
        }
        else {
            console.log(xelib.Path(id) + ': ' + recordValue + ' == ' + writeValue);
        }
    }

    let writeArrayToElement = function(id, path, value) {
        xelib.RemoveElement(id, path);
        const arrayObj = value.reduce(
            (obj, elem, idx) => {
                obj['[' + idx + ']'] = elem;
                return obj;
            },
            {}
        );
        xelib.WithHandle(
            xelib.AddElement(id, path),
            arrayId => writeObjectToElementRecursive(arrayId, arrayObj)
        );
    }

    let isArrayElement = function(id) {
        return xelib.WithHandle(
            xelib.GetElement(id, ''),
            resolvedId => {
                const smashType = xelib.SmashType(resolvedId);
                return (
                    smashType === stUnsortedArray
                    || smashType === stUnsortedStructArray
                    || smashType === stSortedArray
                    || smashType === stSortedStructArray
                );
            }
        );
    }

    // path must be a direct child of id
    let getOrAddElement = function(id, path) {
        let childId = xelib.GetElement(id, path);
        if (childId === 0) {
            if (isArrayElement(id)) {
                childId = xelib.AddArrayItem(id, '');
                console.log(xelib.Path(childId) + ': added array item at ' + path);
            }
            else {
                try {
                    childId = xelib.AddElement(id, path);
                    console.log(xelib.Path(childId) + ': added element at ' + path);
                }
                catch (ex) {
                    // AddElement might fail if we try to add an array count element
                    // there doesn't seem to be a way to check this beforehand
                    console.log(xelib.Path(id) + ': could not add element at ' + path);
                }
            }
        }
        return childId;
    }

    let writeObjectToElementRecursive = function(id, obj) {
        for (const [key, value] of Object.entries(obj)) {
            if (key === 'Record Header') {
                continue;
            }

            const childId = getOrAddElement(id, key);

            if (childId === 0) {
                continue;
            }

            xelib.WithHandle(
                childId,
                elementId => {
                    const childType = xelib.ValueType(elementId);
                    switch (childType) {
                        case vtUnknown:
                            break;
                        case vtArray:
                            writeArrayToElement(id, key, value);
                            break;
                        case vtStruct:
                            writeObjectToElementRecursive(elementId, value);
                            break;
                        default:
                            writeValueToElement(elementId, value, childType);
                            break;
                    }
                }
            );
        }
    }

    this.writeObjectToElement = function(id, obj) {
        writeObjectToElementRecursive(id, obj);
    }
});
